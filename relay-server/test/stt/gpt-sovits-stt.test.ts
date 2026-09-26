import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { GptSovitsSTTProvider, type GptSovitsAsrInvocation } from '../../src/stt/gpt-sovits.js'

const settings = {
  gptSovitsRoot: 'C:\\gpt-sovits',
  pythonExecutable: 'python',
  language: 'zh',
  endpointingMs: 500,
  sampleRate: 16000,
}

it('rejects missing offline runtime assets during production connect', async () => {
  const provider = new GptSovitsSTTProvider()
  await expect(
    provider.connect({ ...settings, gptSovitsRoot: 'missing-gpt-sovits-installation' })
  ).rejects.toMatchObject({
    userMessage: expect.stringContaining('recognition readiness'),
  })
})

function speech(samples: number): string {
  const buffer = Buffer.alloc(samples * 2)
  for (let index = 0; index < samples; index += 1)
    buffer.writeInt16LE(index % 2 === 0 ? 8000 : -8000, index * 2)
  return buffer.toString('base64')
}

function silence(samples: number): string {
  return Buffer.alloc(samples * 2).toString('base64')
}

function tone(samples: number, amplitude: number): string {
  const buffer = Buffer.alloc(samples * 2)
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(index % 2 === 0 ? amplitude : -amplitude, index * 2)
  }
  return buffer.toString('base64')
}

function quietFrameWithTransientPeak(): string {
  const buffer = Buffer.alloc(160 * 2)
  buffer.writeInt16LE(500, 0)
  return buffer.toString('base64')
}

async function readWav(path: string) {
  const buffer = await readFile(path)
  return {
    channels: buffer.readUInt16LE(22),
    sampleRate: buffer.readUInt32LE(24),
    bitsPerSample: buffer.readUInt16LE(34),
    dataBytes: buffer.readUInt32LE(40),
  }
}

describe('GPT-SoVITS recognition', () => {
  it('emits one final transcript per utterance and never a partial transcript', async () => {
    const transcripts = ['第一句', '第二句']
    const runAsr = vi.fn(async (_invocation: GptSovitsAsrInvocation) => transcripts.shift() ?? '')
    const provider = new GptSovitsSTTProvider({ runAsr })
    const finals: string[] = []
    const partials: string[] = []
    provider.onFinalTranscript((text) => finals.push(text))
    provider.onPartialTranscript((text) => partials.push(text))
    await provider.connect(settings)

    provider.processAudio(speech(16000))
    provider.processAudio(silence(8000))
    await vi.waitFor(() => expect(finals).toEqual(['第一句']))

    provider.processAudio(speech(16000))
    provider.processAudio(silence(8000))
    await vi.waitFor(() => expect(finals).toEqual(['第一句', '第二句']))

    expect(runAsr).toHaveBeenCalledTimes(2)
    expect(partials).toEqual([])
    expect(runAsr.mock.calls[0][0]).toMatchObject({
      language: 'zh',
      gptSovitsRoot: 'C:\\gpt-sovits',
      pythonExecutable: 'python',
    })
  })

  it('finalizes a pending utterance when the client commits', async () => {
    const runAsr = vi.fn(async () => '已提交')
    const provider = new GptSovitsSTTProvider({ runAsr })
    const finals: string[] = []
    provider.onFinalTranscript((text) => finals.push(text))
    await provider.connect(settings)

    provider.processAudio(speech(16000))
    expect(runAsr).not.toHaveBeenCalled()
    provider.commit()

    await vi.waitFor(() => expect(finals).toEqual(['已提交']))
    expect(runAsr).toHaveBeenCalledTimes(1)
  })

  it('serializes offline ASR invocations across endpointed utterances', async () => {
    let active = 0
    let maxActive = 0
    const releases: Array<() => void> = []
    const runAsr = vi.fn(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise<void>((resolve) => releases.push(resolve))
      active -= 1
      return 'recognized'
    })
    const provider = new GptSovitsSTTProvider({ runAsr })
    await provider.connect({ ...settings, endpointingMs: 10 })

    provider.processAudio(speech(160))
    provider.processAudio(silence(160))
    provider.processAudio(speech(160))
    provider.processAudio(silence(160))

    await vi.waitFor(() => expect(runAsr).toHaveBeenCalledTimes(1))
    expect(maxActive).toBe(1)

    releases.shift()?.()
    await vi.waitFor(() => expect(runAsr).toHaveBeenCalledTimes(2))
    expect(maxActive).toBe(1)

    releases.shift()?.()
    await provider.disconnect()
  })

  it('endpoints through isolated quiet-frame noise peaks', async () => {
    const runAsr = vi.fn(async () => 'recognized')
    const provider = new GptSovitsSTTProvider({ runAsr })
    await provider.connect({ ...settings, endpointingMs: 20 })

    provider.processAudio(speech(160))
    provider.processAudio(quietFrameWithTransientPeak())
    provider.processAudio(quietFrameWithTransientPeak())

    await vi.waitFor(() => expect(runAsr).toHaveBeenCalledTimes(1))
    await provider.disconnect()
  })

  it('adapts endpointing to sustained background noise', async () => {
    const runAsr = vi.fn(async () => 'recognized over road noise')
    const provider = new GptSovitsSTTProvider({ runAsr })
    await provider.connect({ ...settings, endpointingMs: 20 })

    // Calibrate against half a second of steady road noise. Background alone
    // must not continuously launch the expensive offline recognizer.
    for (let index = 0; index < 50; index += 1) provider.processAudio(tone(160, 1_000))
    expect(runAsr).not.toHaveBeenCalled()

    // Speech rises clearly above that floor; returning to the same road noise
    // should now count as the endpoint rather than perpetual speech.
    for (let index = 0; index < 5; index += 1) provider.processAudio(tone(160, 4_000))
    provider.processAudio(tone(160, 1_000))
    provider.processAudio(tone(160, 1_000))

    await vi.waitFor(() => expect(runAsr).toHaveBeenCalledTimes(1))
    await provider.disconnect()
  })

  it('does not publish a pending recognition after disconnect', async () => {
    let release: ((text: string) => void) | undefined
    const runAsr = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve
        })
    )
    const provider = new GptSovitsSTTProvider({ runAsr })
    const finals: string[] = []
    const errors: string[] = []
    provider.onFinalTranscript((text) => finals.push(text))
    provider.onError((message) => errors.push(message))
    await provider.connect({ ...settings, endpointingMs: 10 })

    provider.processAudio(speech(160))
    provider.processAudio(silence(320))
    await vi.waitFor(() => expect(runAsr).toHaveBeenCalledTimes(1))

    const disconnected = provider.disconnect()
    release?.('late result')
    await disconnected

    expect(finals).toEqual([])
    expect(errors).toEqual([])
  })

  it('writes a 16 kHz mono PCM16 WAV for the offline ASR', async () => {
    const invocations: GptSovitsAsrInvocation[] = []
    const observed: Array<Awaited<ReturnType<typeof readWav>>> = []
    const provider = new GptSovitsSTTProvider({
      runAsr: async (invocation) => {
        invocations.push(invocation)
        const files = await readdir(invocation.inputDirectory)
        expect(files).toHaveLength(1)
        observed.push(await readWav(join(invocation.inputDirectory, files[0])))
        return '好的'
      },
    })
    provider.onFinalTranscript(() => undefined)
    await provider.connect(settings)

    provider.processAudio(speech(16000))
    provider.processAudio(silence(8000))
    await vi.waitFor(() => expect(invocations).toHaveLength(1))

    expect(observed[0].channels).toBe(1)
    expect(observed[0].sampleRate).toBe(16000)
    expect(observed[0].bitsPerSample).toBe(16)
    expect(observed[0].dataBytes).toBe(16000 * 2)
  })

  it('normalizes a higher client sample rate down to the 16 kHz ASR rate', async () => {
    const observed: Array<Awaited<ReturnType<typeof readWav>>> = []
    const provider = new GptSovitsSTTProvider({
      runAsr: async (invocation) => {
        const files = await readdir(invocation.inputDirectory)
        observed.push(await readWav(join(invocation.inputDirectory, files[0])))
        return '重采样'
      },
    })
    provider.onFinalTranscript(() => undefined)
    await provider.connect({ ...settings, sampleRate: 32000 })

    provider.processAudio(speech(32000))
    provider.processAudio(silence(16000))
    await vi.waitFor(() => expect(observed).toHaveLength(1))

    expect(observed[0].sampleRate).toBe(16000)
    expect(observed[0].dataBytes).toBe(16000 * 2)
  })

  it('fails at connect without the local installation path', async () => {
    const provider = new GptSovitsSTTProvider({ runAsr: async () => '不应出现' })
    const finals: string[] = []
    provider.onFinalTranscript((text) => finals.push(text))

    await expect(provider.connect({ sampleRate: 16000 })).rejects.toMatchObject({
      userMessage: expect.stringContaining('installation path'),
    })
    expect(finals).toEqual([])
  })

  it('keeps recognizing after one utterance fails', async () => {
    let attempt = 0
    const runAsr = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('asr crashed')
      if (attempt === 2) return '   '
      return '第二句'
    })
    const provider = new GptSovitsSTTProvider({ runAsr })
    const finals: string[] = []
    const errors: string[] = []
    provider.onFinalTranscript((text) => finals.push(text))
    provider.onError((message) => errors.push(message))
    await provider.connect(settings)

    provider.processAudio(speech(16000))
    provider.processAudio(silence(8000))
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(finals).toEqual([])
    expect(errors[0]).toContain('asr crashed')

    provider.processAudio(speech(16000))
    provider.processAudio(silence(8000))
    await vi.waitFor(() => expect(runAsr).toHaveBeenCalledTimes(2))
    expect(errors).toHaveLength(1)

    provider.processAudio(speech(16000))
    provider.processAudio(silence(8000))
    await vi.waitFor(() => expect(finals).toEqual(['第二句']))

    expect(runAsr).toHaveBeenCalledTimes(3)
  })

  it('ignores an empty transcript when the recording contains no recognizable speech', async () => {
    const runAsr = vi.fn(async () => '')
    const provider = new GptSovitsSTTProvider({ runAsr })
    const finals: string[] = []
    const errors: string[] = []
    provider.onFinalTranscript((text) => finals.push(text))
    provider.onError((message) => errors.push(message))
    await provider.connect({ ...settings, endpointingMs: 20 })

    provider.processAudio(speech(160))
    provider.processAudio(silence(320))
    await vi.waitFor(() => expect(runAsr).toHaveBeenCalledTimes(1))

    expect(finals).toEqual([])
    expect(errors).toEqual([])
    await provider.disconnect()
  })
})

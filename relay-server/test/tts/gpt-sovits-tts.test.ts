import { describe, expect, it, vi } from 'vitest'
import { GptSovitsTTSProvider } from '../../src/tts/gpt-sovits.js'
import type { GptSovitsSynthesisRequest } from '../../src/tts/gpt-sovits.js'

const settings = {
  serviceUrl: 'http://127.0.0.1:9880',
  referenceAudioPath: 'C:\\gpt-sovits\\refs\\voice.wav',
  promptText: '参考文本',
  promptLang: 'zh',
  textLang: 'zh',
  speedFactor: 1.1,
  sampleRate: 32000,
}

function wav(pcm: Buffer, sampleRate: number): Uint8Array {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return new Uint8Array(Buffer.concat([header, pcm]))
}

function pcm(samples: number): Buffer {
  const buffer = Buffer.alloc(samples * 2)
  for (let index = 0; index < samples; index += 1) buffer.writeInt16LE((index % 64) * 8, index * 2)
  return buffer
}

async function collected(provider: GptSovitsTTSProvider, text: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of provider.synthesize(text))
    chunks.push(Buffer.from(chunk.data, 'base64'))
  return Buffer.concat(chunks)
}

describe('GPT-SoVITS synthesis', () => {
  it('rejects an unavailable service during production connect', async () => {
    const provider = new GptSovitsTTSProvider()
    await expect(
      provider.connect({ ...settings, serviceUrl: 'http://127.0.0.1:1' })
    ).rejects.toMatchObject({
      userMessage: expect.stringMatching(/service|baseline/i),
    })
  })
  it('aborts a pending request and permits synthesis in the next Turn', async () => {
    let signal: AbortSignal | undefined
    let calls = 0
    const provider = new GptSovitsTTSProvider({
      requestSynthesis: async (_request, cancellation) => {
        if (++calls > 1) return wav(pcm(16), 32000)
        signal = cancellation
        return new Promise<Uint8Array>((_resolve, reject) => {
          cancellation?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          })
        })
      },
    })
    await provider.connect({ ...settings })
    const pending = collected(provider, 'First.')
    await provider.stop()
    expect(signal?.aborted).toBe(true)
    await expect(pending).resolves.toHaveLength(0)
    await expect(collected(provider, 'Next.')).resolves.toHaveLength(32)
  })
  it('requests one local synthesis per speech unit and decodes it to PCM16', async () => {
    const audio = pcm(1600)
    const requestSynthesis = vi.fn(async (_request: GptSovitsSynthesisRequest) => wav(audio, 32000))
    const provider = new GptSovitsTTSProvider({ requestSynthesis })
    await provider.connect({ ...settings, sampleRate: 32000 })

    const decoded = await collected(provider, '你好。')

    expect(requestSynthesis).toHaveBeenCalledTimes(1)
    expect(requestSynthesis).toHaveBeenCalledWith(
      {
        text: '你好。',
        textLang: 'zh',
        referenceAudioPath: 'C:\\gpt-sovits\\refs\\voice.wav',
        promptText: '参考文本',
        promptLang: 'zh',
        mediaType: 'wav',
        speedFactor: 1.1,
      },
      expect.any(AbortSignal)
    )
    expect(decoded.equals(audio)).toBe(true)
    expect(decoded.includes(Buffer.from('RIFF'))).toBe(false)
  })

  it('resamples the service output to the requested client rate', async () => {
    const audio = pcm(1600)
    const provider = new GptSovitsTTSProvider({
      requestSynthesis: async () => wav(audio, 32000),
    })
    await provider.connect({ ...settings, sampleRate: 16000 })

    const decoded = await collected(provider, '你好。')

    expect(decoded.length).toBe(audio.length / 2)
  })

  it('reports synthesis failure without substituting another provider', async () => {
    const provider = new GptSovitsTTSProvider({
      requestSynthesis: async () => {
        throw new Error('service exploded')
      },
    })
    await provider.connect({ ...settings })

    await expect(collected(provider, '你好。')).rejects.toMatchObject({
      userMessage: expect.stringContaining('service exploded'),
    })
    expect(provider.id).toBe('gpt-sovits-tts')

    const undecodable = new GptSovitsTTSProvider({
      requestSynthesis: async () => new Uint8Array(Buffer.from('not audio')),
    })
    await undecodable.connect({ ...settings })
    await expect(collected(undecodable, '你好。')).rejects.toMatchObject({
      userMessage: expect.stringContaining('WAV'),
    })
  })

  it('fails closed when the installation does not match the synthesis baseline', async () => {
    const provider = new GptSovitsTTSProvider({
      requestSynthesis: async () => wav(pcm(16), 32000),
      probeInstallation: {
        probeSynthesis: async () => ({ controlReachable: true, supportedFields: ['text'] }),
        probeRecognition: async () => ({
          scriptPresent: true,
          presentArguments: ['--input_folder', '--output_folder', '--model_size', '--language'],
          presentAssets: [
            'tools/asr/models/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch',
            'tools/asr/models/speech_fsmn_vad_zh-cn-16k-common-pytorch',
          ],
        }),
      },
    })

    await expect(provider.connect({ ...settings })).rejects.toMatchObject({
      userMessage: expect.stringContaining('synthesis capability baseline'),
    })
  })

  it('stops in-flight synthesis without emitting further audio', async () => {
    const audio = pcm(800)
    let release: ((value: Uint8Array) => void) | undefined
    const pending = new Promise<Uint8Array>((resolve) => {
      release = resolve
    })
    const provider = new GptSovitsTTSProvider({ requestSynthesis: () => pending })
    await provider.connect({ ...settings })

    const chunks: string[] = []
    const iteration = (async () => {
      for await (const chunk of provider.synthesize('你好。')) chunks.push(chunk.data)
    })()
    await provider.stop()
    release?.(wav(audio, 32000))
    await iteration

    expect(chunks).toEqual([])
  })

  it('reports only the synthesis progress it can observe', async () => {
    const provider = new GptSovitsTTSProvider({
      requestSynthesis: async () => wav(pcm(16), 32000),
    })
    await provider.connect({ ...settings })

    expect(provider.getPlaybackPosition()).toBe(0)
    await collected(provider, '你好。')
    await collected(provider, '继续')

    expect(provider.getPlaybackPosition()).toBe(5)
  })
})

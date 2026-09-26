import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'

const request = {
  text: '你好。',
  textLang: 'zh',
  referenceAudioPath: 'C:\\refs\\voice.wav',
  promptText: '参考',
  promptLang: 'zh',
  mediaType: 'wav' as const,
  speedFactor: 1.1,
}

describe('GPT-SoVITS production transports', () => {
  it('posts the recorded synthesis fields to the configured service', async () => {
    const { createGptSovitsSynthesisTransport } =
      await import('../../src/voice/gpt-sovits-transports.js')
    const audio = new Uint8Array([1, 2, 3, 4])
    const fetchLike = vi.fn(async (_url: string, _init: { method: string; body: string }) => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => audio.buffer,
    }))
    const transport = createGptSovitsSynthesisTransport({
      serviceUrl: 'http://127.0.0.1:9880',
      fetch: fetchLike as unknown as typeof fetch,
    })

    const bytes = await transport.requestSynthesis(request)

    expect(fetchLike).toHaveBeenCalledTimes(1)
    expect(fetchLike.mock.calls[0][0]).toBe('http://127.0.0.1:9880/tts')
    expect(fetchLike.mock.calls[0][1].method).toBe('POST')
    expect(JSON.parse(fetchLike.mock.calls[0][1].body)).toEqual({
      text: '你好。',
      text_lang: 'zh',
      ref_audio_path: 'C:\\refs\\voice.wav',
      prompt_text: '参考',
      prompt_lang: 'zh',
      media_type: 'wav',
      speed_factor: 1.1,
    })
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4])
  })

  it('reports a service failure with its status and body', async () => {
    const { createGptSovitsSynthesisTransport } =
      await import('../../src/voice/gpt-sovits-transports.js')
    const transport = createGptSovitsSynthesisTransport({
      serviceUrl: 'http://127.0.0.1:9880',
      fetch: (async () => ({
        ok: false,
        status: 503,
        text: async () => 'model not loaded',
        arrayBuffer: async () => new ArrayBuffer(0),
      })) as unknown as typeof fetch,
    })

    await expect(transport.requestSynthesis(request)).rejects.toMatchObject({
      userMessage: expect.stringContaining('503'),
    })
    await expect(transport.requestSynthesis(request)).rejects.toMatchObject({
      userMessage: expect.stringContaining('model not loaded'),
    })
  })

  it('invokes the bundled offline ASR with the recorded arguments and reads its list output', async () => {
    const { createGptSovitsAsrRunner } = await import('../../src/voice/gpt-sovits-transports.js')
    const directory = await mkdtemp(join(tmpdir(), 'gpt-sovits-transport-'))
    const inputDirectory = join(directory, 'in')
    const outputDirectory = join(directory, 'out')
    await mkdir(inputDirectory, { recursive: true })
    await mkdir(outputDirectory, { recursive: true })
    const runProcess = vi.fn(async (file: string, args: string[], _options: unknown) => {
      const target = args[args.indexOf('-o') + 1]
      await writeFile(join(target, 'in.list'), `C:\\tmp\\in\\utterance.wav|in|ZH|你好世界`, 'utf8')
      return { file, code: 0, stdout: '', stderr: '' }
    })
    const runner = createGptSovitsAsrRunner({ runProcess })

    const text = await runner.runAsr({
      gptSovitsRoot: 'C:\\gpt-sovits',
      pythonExecutable: 'python',
      language: 'zh',
      inputDirectory,
      outputDirectory,
    })

    expect(text).toBe('你好世界')
    expect(runProcess).toHaveBeenCalledWith(
      'python',
      [
        '-c',
        expect.stringContaining('_local_first_snapshot_download'),
        join('C:\\gpt-sovits', 'tools', 'asr', 'funasr_asr.py'),
        '-i',
        inputDirectory,
        '-o',
        outputDirectory,
        '-s',
        'large',
        '-l',
        'zh',
      ],
      expect.objectContaining({
        cwd: 'C:\\gpt-sovits',
        env: expect.objectContaining({
          MODELSCOPE_HUB_FILE_LOCK: 'false',
          PYTHONIOENCODING: 'utf-8',
        }),
      })
    )
  })

  it('reports a failed offline ASR invocation with its diagnostics', async () => {
    const { createGptSovitsAsrRunner } = await import('../../src/voice/gpt-sovits-transports.js')
    const runner = createGptSovitsAsrRunner({
      runProcess: async () => ({
        file: 'python',
        code: 1,
        stdout: '',
        stderr: 'ModuleNotFoundError: funasr',
      }),
    })

    await expect(
      runner.runAsr({
        gptSovitsRoot: 'C:\\gpt-sovits',
        pythonExecutable: 'python',
        language: 'zh',
        inputDirectory: 'C:\\tmp\\in',
        outputDirectory: 'C:\\tmp\\out',
      })
    ).rejects.toMatchObject({ userMessage: expect.stringContaining('funasr') })
  })

  it('reports the provider output when the offline ASR writes no transcript lines', async () => {
    const { createGptSovitsAsrRunner } = await import('../../src/voice/gpt-sovits-transports.js')
    const directory = await mkdtemp(join(tmpdir(), 'gpt-sovits-transport-empty-'))
    const inputDirectory = join(directory, 'in')
    const outputDirectory = join(directory, 'out')
    await mkdir(inputDirectory, { recursive: true })
    await mkdir(outputDirectory, { recursive: true })
    const runner = createGptSovitsAsrRunner({
      runProcess: async (file: string, args: string[]) => {
        await writeFile(join(args[args.indexOf('-o') + 1], 'in.list'), '', 'utf8')
        return {
          file,
          code: 0,
          stdout: 'Traceback (most recent call last):\nRuntimeError: CUDA out of memory',
          stderr: '',
        }
      },
    })

    await expect(
      runner.runAsr({
        gptSovitsRoot: 'C:\\gpt-sovits',
        pythonExecutable: 'python',
        language: 'zh',
        inputDirectory,
        outputDirectory,
      })
    ).rejects.toMatchObject({
      userMessage: expect.stringContaining('CUDA out of memory'),
    })
  })

  it('returns an empty transcript for a clean no-speech result', async () => {
    const { createGptSovitsAsrRunner } = await import('../../src/voice/gpt-sovits-transports.js')
    const directory = await mkdtemp(join(tmpdir(), 'gpt-sovits-transport-no-speech-'))
    const inputDirectory = join(directory, 'in')
    const outputDirectory = join(directory, 'out')
    await mkdir(inputDirectory, { recursive: true })
    await mkdir(outputDirectory, { recursive: true })
    const runner = createGptSovitsAsrRunner({
      runProcess: async (file: string, args: string[]) => {
        await writeFile(join(args[args.indexOf('-o') + 1], 'in.list'), '', 'utf8')
        return { file, code: 0, stdout: '', stderr: '' }
      },
    })

    await expect(
      runner.runAsr({
        gptSovitsRoot: 'C:\\gpt-sovits',
        pythonExecutable: 'python',
        language: 'zh',
        inputDirectory,
        outputDirectory,
      })
    ).resolves.toBe('')
  })

  it('treats FunASR empty-result IndexError as no speech, not a provider failure', async () => {
    const { createGptSovitsAsrRunner } = await import('../../src/voice/gpt-sovits-transports.js')
    const directory = await mkdtemp(join(tmpdir(), 'gpt-sovits-transport-empty-result-'))
    const inputDirectory = join(directory, 'in')
    const outputDirectory = join(directory, 'out')
    await mkdir(inputDirectory, { recursive: true })
    await mkdir(outputDirectory, { recursive: true })
    const runner = createGptSovitsAsrRunner({
      runProcess: async (file: string, args: string[]) => {
        await writeFile(join(args[args.indexOf('-o') + 1], 'in.list'), '', 'utf8')
        return {
          file,
          code: 0,
          stdout: 'IndexError: list index out of range',
          stderr: '',
        }
      },
    })

    await expect(
      runner.runAsr({
        gptSovitsRoot: 'C:\\gpt-sovits',
        pythonExecutable: 'python',
        language: 'zh',
        inputDirectory,
        outputDirectory,
      })
    ).resolves.toBe('')
  })

  it('bounds a wedged offline ASR invocation instead of waiting forever', async () => {
    const { createGptSovitsAsrRunner } = await import('../../src/voice/gpt-sovits-transports.js')
    const runner = createGptSovitsAsrRunner({
      timeoutMs: 300,
      runProcess: () => new Promise(() => {}),
    })

    await expect(
      runner.runAsr({
        gptSovitsRoot: 'C:\\gpt-sovits',
        pythonExecutable: 'python',
        language: 'zh',
        inputDirectory: 'C:\\gpt-sovits',
        outputDirectory: 'C:\\gpt-sovits',
      })
    ).rejects.toMatchObject({ userMessage: expect.stringContaining('timed out') })
  })
})

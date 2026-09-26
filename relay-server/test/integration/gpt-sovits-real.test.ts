import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { createSTTProvider } from '../../src/stt/index.js'
import { createTTSProvider } from '../../src/tts/index.js'
import { GPT_SOVITS_BASELINE } from '../../src/voice/gpt-sovits-baseline.js'

const gptSovitsRoot = process.env.GPT_SOVITS_ROOT
const serviceUrl = process.env.GPT_SOVITS_SERVICE_URL
const referenceAudio = process.env.GPT_SOVITS_REFERENCE_AUDIO
const enabled = Boolean(gptSovitsRoot && serviceUrl && referenceAudio)
const run = promisify(execFile)
const optInReason =
  'Real GPT-SoVITS acceptance requires GPT_SOVITS_ROOT, GPT_SOVITS_SERVICE_URL and GPT_SOVITS_REFERENCE_AUDIO with a running local synthesis service and a working offline ASR runtime'

if (!enabled) {
  console.info(`[gpt-sovits-real] skipping: ${optInReason}`)
}

describe(`GPT-SoVITS real acceptance (opt-in: ${optInReason})`, () => {
  it.skipIf(!enabled)(
    'synthesizes real speech and recognizes it back through the provider boundaries',
    async (context) => {
      let openApi: {
        paths: Record<string, unknown>
        components: { schemas: { TTS_Request: { properties: Record<string, unknown> } } }
      }
      try {
        const openApiResponse = await fetch(new URL('/openapi.json', serviceUrl), {
          signal: AbortSignal.timeout(15_000),
        })
        if (!openApiResponse.ok) throw new Error('service unavailable')
        openApi = (await openApiResponse.json()) as typeof openApi
      } catch {
        context.skip('Local GPT-SoVITS synthesis service is not running')
        return
      }
      try {
        await run(process.env.GPT_SOVITS_PYTHON ?? 'python', ['-c', 'import funasr'], {
          cwd: gptSovitsRoot,
          timeout: 45_000,
          windowsHide: true,
        })
      } catch {
        context.skip('Local GPT-SoVITS offline ASR runtime is not working')
        return
      }
      const baseline = GPT_SOVITS_BASELINE
      expect(openApi.paths).toHaveProperty(baseline.synthesis.endpoint)
      expect(openApi.paths).toHaveProperty(baseline.synthesis.controlEndpoint)
      const synthesisFields = Object.keys(openApi.components.schemas.TTS_Request.properties)
      expect(synthesisFields).toEqual(expect.arrayContaining(baseline.synthesis.requiredFields))
      const script = await readFile(
        join(gptSovitsRoot as string, baseline.recognition.script),
        'utf8'
      )
      for (const argument of baseline.recognition.arguments) expect(script).toContain(argument)
      for (const asset of baseline.recognition.requiredAssets) {
        try {
          await access(join(gptSovitsRoot as string, asset))
        } catch {
          context.skip('Local GPT-SoVITS offline ASR model assets are missing')
          return
        }
      }

      const tts = createTTSProvider('gpt-sovits-tts')
      const stt = createSTTProvider('gpt-sovits-stt')
      const errors: string[] = []
      const finals: string[] = []
      stt.onError((message) => errors.push(message))
      stt.onFinalTranscript((text) => finals.push(text))

      await tts.connect({
        serviceUrl,
        referenceAudioPath: referenceAudio,
        promptText: process.env.GPT_SOVITS_PROMPT_TEXT ?? '',
        promptLang: process.env.GPT_SOVITS_PROMPT_LANG ?? 'zh',
        textLang: process.env.GPT_SOVITS_TEXT_LANG ?? 'zh',
        sampleRate: 32000,
      } as never)
      const chunks: Buffer[] = []
      for await (const chunk of tts.synthesize('你好，这是一次本地语音验收。')) {
        chunks.push(Buffer.from(chunk.data, 'base64'))
      }
      const audio = Buffer.concat(chunks)
      expect(audio.length).toBeGreaterThan(0)

      await stt.connect({
        gptSovitsRoot,
        pythonExecutable: process.env.GPT_SOVITS_PYTHON ?? 'python',
        language: process.env.GPT_SOVITS_ASR_LANGUAGE ?? 'zh',
        sampleRate: 32000,
      } as never)
      stt.processAudio(audio.toString('base64'))
      stt.commit()

      // GPT-SoVITS loads FunASR in a child process after commit. Disconnecting
      // immediately would intentionally fence that pending recognition and
      // make a successful ASR run look like an empty result.
      await vi.waitFor(() => expect(finals.join('').length).toBeGreaterThan(0), {
        timeout: 60_000,
      })

      expect(errors).toEqual([])
      await stt.disconnect()
      console.info('[gpt-sovits-real] acceptance evidence', {
        baselineSynthesis: 'matched',
        baselineRecognition: 'matched',
        syntheticAudioBytes: audio.length,
        transcriptCharacters: finals.join('').length,
        terminalOutcome: 'completed',
        failureClass: 'none',
      })
    },
    120_000
  )
})

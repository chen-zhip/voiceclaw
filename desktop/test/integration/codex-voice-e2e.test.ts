import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { parseHarnessExecutionStream } from '@voiceclaw/contracts'
import { codexExecutable, runRealCodexTurn } from './real-codex-app-server.js'
import { CODEX_APP_SERVER_SCHEMA_VERSION } from '../../src/main/providers/codex/app-server-schema.js'
import { createSTTProvider } from '../../../relay-server/src/stt/index.js'
import { createTTSProvider } from '../../../relay-server/src/tts/index.js'
import { HarnessSpeechDelivery } from '../../../relay-server/src/harness-execution/tts-delivery.js'
import { GPT_SOVITS_BASELINE } from '../../../relay-server/src/voice/gpt-sovits-baseline.js'

const run = promisify(execFile)
const localConfigured = Boolean(
  process.env.GPT_SOVITS_ROOT &&
  process.env.GPT_SOVITS_SERVICE_URL &&
  process.env.GPT_SOVITS_REFERENCE_AUDIO
)
const cloudConfigured = Boolean(
  process.env.VOICECLAW_E2E_STT_API_KEY && process.env.VOICECLAW_E2E_TTS_API_KEY
)
const enabled = Boolean(codexExecutable && (localConfigured || cloudConfigured))
const providerSet = localConfigured ? 'gpt-sovits' : 'cloud'
const prerequisite =
  'Real voice acceptance needs VOICECLAW_CODEX_E2E_EXECUTABLE and either a running local GPT-SoVITS STT/TTS pair or both cloud STT/TTS test credentials'

if (!enabled) console.info('[codex-voice-e2e] skipping: ' + prerequisite)

describe('Codex STT/TTS voice loop acceptance (opt-in: ' + prerequisite + ')', () => {
  it.skipIf(!enabled)(
    'routes recognized speech through real Codex output and Relay TTS audio',
    async (context) => {
      if (localConfigured && !(await localRuntimeReady())) {
        context.skip('Local GPT-SoVITS service or offline ASR runtime is unavailable')
        return
      }

      const workspacePath = await mkdtemp(join(tmpdir(), 'codex-voice-workspace-'))
      const stt = createSTTProvider(localConfigured ? 'gpt-sovits-stt' : 'deepgram')
      const tts = createTTSProvider(localConfigured ? 'gpt-sovits-tts' : 'elevenlabs')
      try {
        const sampleRate = localConfigured ? 32000 : 24000
        await tts.connect(
          localConfigured
            ? ({
                serviceUrl: process.env.GPT_SOVITS_SERVICE_URL,
                referenceAudioPath: process.env.GPT_SOVITS_REFERENCE_AUDIO,
                promptText: process.env.GPT_SOVITS_PROMPT_TEXT ?? '',
                promptLang: process.env.GPT_SOVITS_PROMPT_LANG ?? 'zh',
                textLang: process.env.GPT_SOVITS_TEXT_LANG ?? 'zh',
                sampleRate,
              } as never)
            : { apiKey: process.env.VOICECLAW_E2E_TTS_API_KEY, sampleRate }
        )
        await stt.connect(
          localConfigured
            ? ({
                gptSovitsRoot: process.env.GPT_SOVITS_ROOT,
                pythonExecutable: process.env.GPT_SOVITS_PYTHON,
                language: process.env.GPT_SOVITS_ASR_LANGUAGE ?? 'zh',
                sampleRate,
              } as never)
            : { apiKey: process.env.VOICECLAW_E2E_STT_API_KEY, language: 'en', sampleRate }
        )

        const prompt = localConfigured
          ? '你好，这是一次语音链路验收。'
          : 'Hello, this is a voice loop acceptance test.'
        const fixtureAudio: string[] = []
        for await (const chunk of tts.synthesize(prompt)) fixtureAudio.push(chunk.data)
        expect(fixtureAudio.length).toBeGreaterThan(0)

        const transcripts: string[] = []
        const recognitionErrors: string[] = []
        stt.onFinalTranscript((value) => transcripts.push(value))
        stt.onError((message) => recognitionErrors.push(message))
        for (const audio of fixtureAudio) stt.processAudio(audio)
        stt.commit()
        await vi.waitFor(() => expect(transcripts.join('').length).toBeGreaterThan(0), {
          timeout: 70_000,
        })
        expect(recognitionErrors).toEqual([])

        const turn = await runRealCodexTurn({
          executable: codexExecutable as string,
          workspacePath,
          inputText: '用户通过语音识别说：' + transcripts.join('') + '。请只回复：链路验收通过。',
        })
        expect(turn.version).toContain(CODEX_APP_SERVER_SCHEMA_VERSION)
        const events = turn.events
        expect(parseHarnessExecutionStream(events).success).toBe(true)
        const speech = events.filter(
          (event) => event.kind === 'semantic-output' && event.payload.channel === 'speech'
        )
        expect(speech.length).toBeGreaterThan(0)
        expect(speech.map((event) => String(event.payload.text)).join('')).toContain('链路验收通过')
        expect(events.at(-1)).toMatchObject({ kind: 'terminal', payload: { outcome: 'completed' } })
        expect(JSON.stringify(events)).not.toMatch(/reasoning|chain of thought/i)

        const audio: string[] = []
        const warnings: string[] = []
        const delivery = new HarnessSpeechDelivery({
          tts,
          sendToClient: (event) => audio.push(event.data),
          warn: (message) => warnings.push(message),
        })
        for (const event of speech) await delivery.write(String(event.payload.text))
        await delivery.finish()
        expect(warnings).toEqual([])
        expect(audio.length).toBeGreaterThan(0)
        const audioBytes = audio.reduce(
          (total, chunk) => total + Buffer.from(chunk, 'base64').length,
          0
        )
        expect(audioBytes).toBeGreaterThan(0)

        console.info('[codex-voice-e2e] acceptance evidence', {
          providerSet,
          codexVersion: turn.version,
          schemaVersion: CODEX_APP_SERVER_SCHEMA_VERSION,
          capabilityProfileVersion: turn.described.capabilityProfileVersion,
          synthesisBaseline: localConfigured ? 'matched' : 'cloud',
          recognitionBaseline: localConfigured ? 'matched' : 'cloud',
          recognizedCharacters: transcripts.join('').length,
          publicSpeechEvents: speech.length,
          audioBytes,
          terminalOutcome: events.at(-1)?.payload.outcome,
          failureClass: 'none',
        })
      } finally {
        await stt.disconnect()
        await tts.disconnect()
        await rm(workspacePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
      }
    },
    180_000
  )
})

async function localRuntimeReady(): Promise<boolean> {
  const root = process.env.GPT_SOVITS_ROOT as string
  try {
    const response = await fetch(new URL('/openapi.json', process.env.GPT_SOVITS_SERVICE_URL), {
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return false
    const schema = (await response.json()) as {
      paths: Record<string, unknown>
      components: { schemas: { TTS_Request: { properties: Record<string, unknown> } } }
    }
    const baseline = GPT_SOVITS_BASELINE
    if (
      !schema.paths[baseline.synthesis.endpoint] ||
      !schema.paths[baseline.synthesis.controlEndpoint]
    )
      return false
    if (
      baseline.synthesis.requiredFields.some(
        (field) => !schema.components.schemas.TTS_Request.properties[field]
      )
    )
      return false
    await access(join(root, baseline.recognition.script))
    const script = await readFile(join(root, baseline.recognition.script), 'utf8')
    if (baseline.recognition.arguments.some((argument) => !script.includes(argument))) return false
    for (const asset of baseline.recognition.requiredAssets) await access(join(root, asset))
    await run(process.env.GPT_SOVITS_PYTHON ?? 'python', ['-c', 'import funasr'], {
      cwd: root,
      timeout: 45_000,
      windowsHide: true,
    })
    return true
  } catch {
    return false
  }
}

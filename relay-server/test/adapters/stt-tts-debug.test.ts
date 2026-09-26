import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdapter } from '../../src/adapters/index.js'
import type { HarnessAdapter } from '../../src/harness-adapter/interface.js'
import type { ChunkHandler, UserMessage } from '../../src/harness-adapter/types.js'
import type { STTProvider } from '../../src/stt/interface.js'
import { createSttTtsDebugRecorder } from '../../src/stt-tts-debug.js'
import type { TTSProvider } from '../../src/tts/interface.js'
import type { SessionConfigEvent } from '../../src/types.js'
import type { SttTtsDebugRecorder } from '../../src/stt-tts-debug.js'

describe('STT/TTS adapter diagnostics', () => {
  it('reports component connection without configuration values', async () => {
    const lines: string[] = []
    const config = sessionConfig()
    const adapter = createAdapter(config, {
      createSTTProvider: () => sttProvider(),
      createHarnessAdapter: () => harnessAdapter(),
      createTTSProvider: () => ttsProvider(),
      debugRecorder: createSttTtsDebugRecorder({
        activation: 'true',
        sink: (line) => lines.push(line),
      }),
    })

    await adapter.connect(config, () => {})

    const records = lines.map(parseRecord)
    expect(records.filter((record) => record.event === 'session.connect.start')).toEqual([
      expect.objectContaining({
        sessionId: 'debug-session',
        stage: 'session',
        componentRole: 'stt',
        providerId: 'gpt-sovits-stt',
      }),
      expect.objectContaining({
        sessionId: 'debug-session',
        stage: 'session',
        componentRole: 'harness',
        providerId: 'claude-code',
      }),
      expect.objectContaining({
        sessionId: 'debug-session',
        stage: 'session',
        componentRole: 'tts',
        providerId: 'gpt-sovits-tts',
      }),
    ])
    expect(records.filter((record) => record.event === 'session.connect.complete')).toHaveLength(3)
    const output = lines.join('\n')
    expect(output).not.toContain('stt-secret')
    expect(output).not.toContain('tts-secret')
    expect(output).not.toContain('harness-secret')
    expect(output).not.toContain('reference.wav')
  })

  describe('reports committed audio and the complete final transcript', () => {
    afterEach(() => vi.useRealTimers())

    it('reports aggregate input metadata and complete approved text', async () => {
      const lines: string[] = []
      const stt = new ControllableSTT()
      const config = sessionConfig()
      config.sttConfig = { ...config.sttConfig, sampleRate: 24_000 }
      const adapter = createAdapter(config, debugDependencies(stt, lines))
      await adapter.connect(config, () => {})

      adapter.sendAudio(Buffer.from([1, 2, 3, 4]).toString('base64'))
      adapter.commitAudio()
      stt.emitFinal('完整的识别\n文本')

      const records = lines.map(parseRecord)
      expect(records).toContainEqual(
        expect.objectContaining({
          event: 'stt.audio.commit',
          sessionId: 'debug-session',
          stage: 'stt',
          providerId: 'gpt-sovits-stt',
          endpointReason: 'client-commit',
          inputBytes: 4,
          sampleRate: 24_000,
          turnId: expect.any(String),
        })
      )
      expect(records).toContainEqual(
        expect.objectContaining({
          event: 'stt.recognition.complete',
          transcriptText: '完整的识别\n文本',
          transcriptCharacters: 8,
          durationMs: expect.any(Number),
          turnId: expect.any(String),
        })
      )
      expect(lines.join('\n')).not.toContain(Buffer.from([1, 2, 3, 4]).toString('base64'))
    })

    it('labels a provider-finalized utterance without a client commit', async () => {
      const lines: string[] = []
      const stt = new ControllableSTT()
      const config = sessionConfig()
      const adapter = createAdapter(config, debugDependencies(stt, lines))
      await adapter.connect(config, () => {})

      adapter.sendAudio(Buffer.from([5, 6]).toString('base64'))
      stt.emitFinal('provider endpoint')

      expect(lines.map(parseRecord)).toContainEqual(
        expect.objectContaining({
          event: 'stt.audio.commit',
          endpointReason: 'provider-finalized',
          inputBytes: 2,
        })
      )
    })

    it('reports error timeout cancellation and disconnect without replacing Client errors', async () => {
      vi.useFakeTimers()
      const lines: string[] = []
      const events: unknown[] = []
      const stt = new ControllableSTT()
      const config = sessionConfig()
      const adapter = createAdapter(config, debugDependencies(stt, lines))
      await adapter.connect(config, (event) => events.push(event))

      adapter.sendAudio(Buffer.from([7, 8]).toString('base64'))
      stt.emitError('recognizer unavailable')
      adapter.commitAudio()
      await vi.advanceTimersByTimeAsync(10_000)
      adapter.cancelResponse()
      adapter.disconnect()

      const records = lines.map(parseRecord)
      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'stt.recognition.failed',
            error: 'recognizer unavailable',
          }),
          expect.objectContaining({ event: 'stt.recognition.timeout' }),
          expect.objectContaining({ event: 'stt.recognition.cancelled' }),
          expect.objectContaining({ event: 'session.disconnect' }),
        ])
      )
      expect(events).toEqual(
        expect.arrayContaining([
          { type: 'error', code: 502, message: 'STT failed: recognizer unavailable' },
          expect.objectContaining({ type: 'error', code: 504 }),
        ])
      )
    })
  })

  it('keeps pipeline behavior identical when diagnostics or the sink change', async () => {
    const disabledLines: string[] = []
    const enabledLines: string[] = []
    const disabled = await runPipeline(
      createSttTtsDebugRecorder({ activation: 'false', sink: (line) => disabledLines.push(line) })
    )
    const enabled = await runPipeline(
      createSttTtsDebugRecorder({ activation: 'true', sink: (line) => enabledLines.push(line) })
    )
    const failedSink = await runPipeline(
      createSttTtsDebugRecorder({
        activation: 'true',
        sink: () => {
          throw new Error('log unavailable')
        },
      })
    )

    expect(disabledLines).toEqual([])
    expect(enabledLines.length).toBeGreaterThan(0)
    expect(enabled).toEqual(disabled)
    expect(failedSink).toEqual(disabled)
    expect(failedSink.events).not.toContainEqual(expect.objectContaining({ type: 'error' }))
  })
})

function parseRecord(line: string): Record<string, unknown> {
  return JSON.parse(line.slice('[stt-tts-debug] '.length))
}

function sessionConfig(): SessionConfigEvent {
  return {
    type: 'session.config',
    provider: 'openai',
    voice: 'test',
    brainAgent: 'none',
    apiKey: 'client-secret',
    mode: 'stt-tts',
    sessionKey: 'debug-session',
    sttProvider: 'gpt-sovits-stt',
    sttConfig: { apiKey: 'stt-secret' },
    harness: 'claude-code',
    harnessConfig: { authToken: 'harness-secret' },
    ttsProvider: 'gpt-sovits-tts',
    ttsConfig: { apiKey: 'tts-secret', voice: 'reference.wav' },
  }
}

function sttProvider(): STTProvider {
  return {
    async connect() {},
    processAudio() {},
    commit() {},
    onPartialTranscript() {},
    onFinalTranscript() {},
    onError() {},
    async disconnect() {},
  }
}

class ControllableSTT implements STTProvider {
  private finalTranscript: (text: string) => void = () => {}
  private error: (message: string) => void = () => {}

  async connect() {}
  processAudio() {}
  commit() {}
  onPartialTranscript() {}
  onFinalTranscript(callback: (text: string) => void) {
    this.finalTranscript = callback
  }
  onError(callback: (message: string) => void) {
    this.error = callback
  }
  async disconnect() {}

  emitFinal(text: string): void {
    this.finalTranscript(text)
  }

  emitError(message: string): void {
    this.error(message)
  }
}

function debugDependencies(stt: STTProvider, lines: string[]) {
  return {
    createSTTProvider: () => stt,
    createHarnessAdapter: () => harnessAdapter(),
    createTTSProvider: () => ttsProvider(),
    debugRecorder: createSttTtsDebugRecorder({
      activation: 'true',
      sink: (line) => lines.push(line),
    }),
  }
}

async function runPipeline(debugRecorder: SttTtsDebugRecorder) {
  const stt = new ControllableSTT()
  const harness = new RecordingHarness()
  const tts = new RecordingTTS()
  const events: Array<Record<string, unknown>> = []
  const config = sessionConfig()
  const adapter = createAdapter(config, {
    createSTTProvider: () => stt,
    createHarnessAdapter: () => harness,
    createTTSProvider: () => tts,
    debugRecorder,
  })
  await adapter.connect(config, (event) => events.push(event as Record<string, unknown>))
  adapter.sendAudio(Buffer.from([1, 2]).toString('base64'))
  adapter.commitAudio()
  stt.emitFinal('recognized input')
  await vi.waitFor(() => expect(tts.texts).toEqual(['Response.']))
  adapter.disconnect()

  return {
    events: events.map(({ turnId, ...event }) => ({
      ...event,
      ...(turnId === undefined ? {} : { turnId: '<turn>' }),
    })),
    calls: {
      harness: harness.messages,
      tts: tts.texts,
    },
  }
}

class RecordingHarness implements HarnessAdapter {
  readonly id = 'claude-code'
  readonly capabilities = {
    structuredOutput: true,
    interruption: true,
    overlay: false,
    streaming: true,
  }
  readonly messages: UserMessage[] = []

  async connect() {}
  async sendMessage(message: UserMessage, onChunk: ChunkHandler) {
    this.messages.push(message)
    await onChunk({ type: 'speech.delta', content: 'Response.' })
    await onChunk({ type: 'complete' })
    return { cancel() {}, done: Promise.resolve() }
  }
  async disconnect() {}
}

class RecordingTTS implements TTSProvider {
  readonly texts: string[] = []

  async connect() {}
  async *synthesize(text: string) {
    this.texts.push(text)
    yield { data: Buffer.from([9]).toString('base64') }
  }
  getPlaybackPosition() {
    return 0
  }
  async stop() {}
  async disconnect() {}
}

function harnessAdapter(): HarnessAdapter {
  return {
    id: 'claude-code',
    capabilities: {
      structuredOutput: true,
      interruption: true,
      overlay: false,
      streaming: true,
    },
    async connect() {},
    async sendMessage() {
      return { cancel() {}, done: Promise.resolve() }
    },
    async disconnect() {},
  }
}

function ttsProvider(): TTSProvider {
  return {
    async connect() {},
    async *synthesize() {},
    getPlaybackPosition: () => 0,
    async stop() {},
    async disconnect() {},
  }
}

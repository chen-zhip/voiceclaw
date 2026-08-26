import { describe, expect, it, vi } from 'vitest'
import { ComposedAdapter } from '../../src/adapters/composed/index.js'
import { OpenAIAdapter } from '../../src/adapters/openai.js'
import { createAdapter, type AdapterFactoryDependencies } from '../../src/adapters/index.js'
import type { HarnessAdapter, HarnessConfig } from '../../src/harness-adapter/interface.js'
import type { ChunkHandler } from '../../src/harness-adapter/types.js'
import type { STTProvider } from '../../src/stt/interface.js'
import type { TTSProvider } from '../../src/tts/interface.js'
import type { SessionConfigEvent } from '../../src/types.js'

describe('STT/TTS adapter factory', () => {
  it('selects session mode', () => {
    const constructed: string[] = []
    const dependencies = componentDependencies(constructed)

    expect(createAdapter(sessionConfig({ mode: undefined }), dependencies)).toBeInstanceOf(
      OpenAIAdapter
    )
    expect(createAdapter(sessionConfig({ mode: 's2s' }), dependencies)).toBeInstanceOf(
      OpenAIAdapter
    )
    expect(constructed).toEqual([])

    expect(createAdapter(sessionConfig({ mode: 'stt-tts' }), dependencies)).toBeInstanceOf(
      ComposedAdapter
    )
    expect(constructed).toEqual(['stt', 'harness', 'tts'])
  })

  it('validates composed configuration', async () => {
    const dependencies = componentDependencies([])
    for (const field of ['sttProvider', 'ttsProvider', 'harness'] as const) {
      expect(() =>
        createAdapter(sessionConfig({ mode: 'stt-tts', [field]: undefined }), dependencies)
      ).toThrow(field)
    }

    const stt = new PipelineSTT()
    const harness = new PipelineHarness()
    const tts = new RecordingTTS()
    const config = sessionConfig({
      mode: 'stt-tts',
      ttsConfig: { sentenceBatchSize: 3 },
      harnessConfig: {
        gatewayUrl: 'http://127.0.0.1:4319',
        authToken: 'harness-token',
        timeoutMs: 5_000,
      },
    })
    const adapter = createAdapter(config, {
      createSTTProvider: () => stt,
      createHarnessAdapter: () => harness,
      createTTSProvider: () => tts,
    })
    await adapter.connect(config, () => {})

    stt.emitFinal('run the task')

    await vi.waitFor(() => expect(tts.synthesized).toHaveLength(1))
    expect(tts.synthesized).toEqual(['One. Two. Three.'])
    expect(harness.connectedConfig).toEqual({
      gatewayUrl: 'http://127.0.0.1:4319',
      authToken: 'harness-token',
      timeoutMs: 5_000,
    })
  })

  it('rejects unavailable components', () => {
    const invalidConfigurations = [
      {
        config: sessionConfig({ mode: 'stt-tts', sttProvider: 'unknown-stt' }),
        expected: /Unknown STT.*deepgram/i,
      },
      {
        config: sessionConfig({ mode: 'stt-tts', harness: 'codex' }),
        expected: /codex.*not available.*claude-code/i,
      },
      {
        config: sessionConfig({ mode: 'stt-tts', ttsProvider: 'unknown-tts' }),
        expected: /Unknown TTS.*elevenlabs/i,
      },
    ]

    for (const { config, expected } of invalidConfigurations) {
      const constructed: string[] = []
      expect(() => createAdapter(config, componentDependencies(constructed))).toThrow(expected)
      expect(constructed).toEqual([])
    }
  })
})

class PipelineSTT implements STTProvider {
  private finalTranscript: (text: string) => void = () => {}

  async connect() {}
  processAudio() {}
  commit() {}
  onPartialTranscript() {}
  onFinalTranscript(callback: (text: string) => void) {
    this.finalTranscript = callback
  }
  onError() {}
  async disconnect() {}

  emitFinal(text: string): void {
    this.finalTranscript(text)
  }
}

class PipelineHarness implements HarnessAdapter {
  readonly id = 'fake'
  readonly capabilities = {
    structuredOutput: true as const,
    interruption: false,
    overlay: false,
    streaming: true,
  }
  connectedConfig: HarnessConfig | null = null

  async connect(config: HarnessConfig) {
    this.connectedConfig = config
  }

  async sendMessage(_message: unknown, onChunk: ChunkHandler) {
    await onChunk({ type: 'speech.delta', content: 'One. Two. Three.' })
    await onChunk({ type: 'complete' })
    return { cancel: () => {}, done: Promise.resolve() }
  }

  async disconnect() {}
}

class RecordingTTS implements TTSProvider {
  readonly synthesized: string[] = []

  async connect() {}

  async *synthesize(text: string) {
    this.synthesized.push(text)
    yield { data: 'YXVkaW8=' }
  }

  getPlaybackPosition() {
    return 0
  }

  async stop() {}
  async disconnect() {}
}

function componentDependencies(constructed: string[]): AdapterFactoryDependencies {
  return {
    createSTTProvider: () => {
      constructed.push('stt')
      return sttProvider()
    },
    createHarnessAdapter: () => {
      constructed.push('harness')
      return harnessAdapter()
    },
    createTTSProvider: () => {
      constructed.push('tts')
      return ttsProvider()
    },
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

function harnessAdapter(): HarnessAdapter {
  return {
    id: 'fake',
    capabilities: {
      structuredOutput: true,
      interruption: false,
      overlay: false,
      streaming: true,
    },
    async connect() {},
    async sendMessage() {
      return { cancel: () => {}, done: Promise.resolve() }
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

function sessionConfig(overrides: Partial<SessionConfigEvent>): SessionConfigEvent {
  return {
    type: 'session.config',
    provider: 'openai',
    voice: 'test',
    brainAgent: 'none',
    apiKey: 'test',
    sttProvider: 'deepgram',
    ttsProvider: 'elevenlabs',
    harness: 'claude-code',
    ...overrides,
  }
}

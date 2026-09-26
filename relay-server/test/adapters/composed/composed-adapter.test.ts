import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposedAdapter } from '../../../src/adapters/composed/index.js'
import { OutputRouter } from '../../../src/adapters/composed/output-router.js'
import type { ProviderAdapter } from '../../../src/adapters/types.js'
import type {
  HarnessAdapter,
  HarnessCapabilities,
  HarnessConfig,
} from '../../../src/harness-adapter/interface.js'
import type {
  ChunkHandler,
  OutputChunk,
  StreamHandle,
  UserMessage,
} from '../../../src/harness-adapter/types.js'
import type { STTConfig, STTProvider, TranscriptCallback } from '../../../src/stt/interface.js'
import type { TTSConfig, TTSProvider } from '../../../src/tts/interface.js'
import type { RelayEvent, SessionConfigEvent } from '../../../src/types.js'

describe('ComposedAdapter', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('manages component lifecycle', async () => {
    const calls: string[] = []
    const stt = new FakeSTT(calls)
    const harness = new FakeHarness(calls)
    const tts = new FakeTTS(calls)
    const events: RelayEvent[] = []
    const adapter: ProviderAdapter = new ComposedAdapter(
      stt,
      harness,
      tts,
      new OutputRouter({ tts, sendToClient: (event) => events.push(event) })
    )

    await adapter.connect(sessionConfig(), (event) => events.push(event))
    adapter.disconnect()

    expect(calls).toEqual([
      'stt.connect',
      'harness.connect',
      'tts.connect',
      'stt.disconnect',
      'harness.disconnect',
      'tts.disconnect',
    ])
  })

  it('tells the STT provider which sample rate the client sold it', async () => {
    const calls: string[] = []
    const stt = new FakeSTT(calls)
    const tts = new FakeTTS(calls)
    const adapter = new ComposedAdapter(
      stt,
      new FakeHarness(calls),
      tts,
      new OutputRouter({ tts, sendToClient: () => {} })
    )

    // The Desktop captures and streams PCM at 24 kHz; a provider that assumes
    // 16 kHz would transcribe a 1.5x slowed-down signal.
    await adapter.connect(
      { ...sessionConfig(), audioSampleRate: 24_000, sttConfig: { model: 'nova-3' } },
      () => {}
    )
    expect(stt.configs.at(-1)).toMatchObject({ model: 'nova-3', sampleRate: 24_000 })

    // An explicit provider setting still wins over the session-wide rate.
    const explicitCalls: string[] = []
    const explicitStt = new FakeSTT(explicitCalls)
    const explicitTts = new FakeTTS(explicitCalls)
    const explicit = new ComposedAdapter(
      explicitStt,
      new FakeHarness(explicitCalls),
      explicitTts,
      new OutputRouter({ tts: explicitTts, sendToClient: () => {} })
    )
    await explicit.connect(
      {
        ...sessionConfig(),
        audioSampleRate: 24_000,
        sttConfig: { model: 'nova-3', sampleRate: 8_000 },
      },
      () => {}
    )
    expect(explicitStt.configs.at(-1)).toMatchObject({ sampleRate: 8_000 })
  })

  it('tells the TTS provider which sample rate the client will play back', async () => {
    const calls: string[] = []
    const tts = new FakeTTS(calls)
    const adapter = new ComposedAdapter(
      new FakeSTT(calls),
      new FakeHarness(calls),
      tts,
      new OutputRouter({ tts, sendToClient: () => {} })
    )

    // The Desktop plays `audio.delta` PCM in its 24 kHz context, so a provider
    // that returns its own default rate would sound slowed down.
    await adapter.connect(
      { ...sessionConfig(), audioSampleRate: 24_000, ttsConfig: { voice: 'v' } },
      () => {}
    )
    expect(tts.configs.at(-1)).toMatchObject({ voice: 'v', sampleRate: 24_000 })

    const explicitCalls: string[] = []
    const explicitTts = new FakeTTS(explicitCalls)
    const explicit = new ComposedAdapter(
      new FakeSTT(explicitCalls),
      new FakeHarness(explicitCalls),
      explicitTts,
      new OutputRouter({ tts: explicitTts, sendToClient: () => {} })
    )
    await explicit.connect(
      {
        ...sessionConfig(),
        audioSampleRate: 24_000,
        ttsConfig: { voice: 'v', sampleRate: 44_100 },
      },
      () => {}
    )
    expect(explicitTts.configs.at(-1)).toMatchObject({ sampleRate: 44_100 })
  })

  it('routes streaming recognition', async () => {
    const calls: string[] = []
    const stt = new FakeSTT(calls)
    const harness = new FakeHarness(calls)
    const tts = new FakeTTS(calls)
    const events: RelayEvent[] = []
    const adapter: ProviderAdapter = new ComposedAdapter(
      stt,
      harness,
      tts,
      new OutputRouter({ tts, sendToClient: (event) => events.push(event) })
    )
    await adapter.connect(sessionConfig(), (event) => events.push(event))

    adapter.sendAudio('cGNt')
    stt.emitPartial('partial words')

    expect(stt.audio).toEqual(['cGNt'])
    expect(events).toContainEqual({
      type: 'transcript.delta',
      text: 'partial words',
      role: 'user',
      source: 'speech',
    })
  })

  it('sends final transcript to Harness', async () => {
    const calls: string[] = []
    const stt = new FakeSTT(calls)
    const harness = new FakeHarness(calls)
    const tts = new FakeTTS(calls)
    const events: RelayEvent[] = []
    const adapter: ProviderAdapter = new ComposedAdapter(
      stt,
      harness,
      tts,
      new OutputRouter({ tts, sendToClient: (event) => events.push(event) })
    )
    await adapter.connect(sessionConfig(), (event) => events.push(event))

    adapter.commitAudio()
    stt.emitFinal('find bugs in auth module')

    await vi.waitFor(() => expect(harness.messages).toHaveLength(1))
    expect(stt.commits).toBe(1)
    expect(harness.messages).toEqual([{ text: 'find bugs in auth module' }])
    expect(events).toContainEqual({
      type: 'transcript.done',
      text: 'find bugs in auth module',
      role: 'user',
    })
  })

  it('routes Harness output to audio', async () => {
    const calls: string[] = []
    const stt = new FakeSTT(calls)
    const harness = new FakeHarness(calls)
    harness.output = [{ type: 'speech.delta', content: 'Three bugs found.' }, { type: 'complete' }]
    const tts = new FakeTTS(calls)
    const events: RelayEvent[] = []
    const adapter: ProviderAdapter = new ComposedAdapter(
      stt,
      harness,
      tts,
      new OutputRouter({ tts, sendToClient: (event) => events.push(event) })
    )
    await adapter.connect(sessionConfig(), (event) => events.push(event))

    stt.emitFinal('find bugs')

    await vi.waitFor(() => expect(events).toContainEqual({ type: 'audio.delta', data: 'YXVkaW8=' }))
    expect(tts.synthesized).toEqual(['Three bugs found.'])
  })

  it('preserves audio on STT timeout', async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const stt = new FakeSTT(calls)
    const harness = new FakeHarness(calls)
    const tts = new FakeTTS(calls)
    const events: RelayEvent[] = []
    const adapter: ProviderAdapter = new ComposedAdapter(
      stt,
      harness,
      tts,
      new OutputRouter({ tts, sendToClient: (event) => events.push(event) })
    )
    await adapter.connect(sessionConfig(), (event) => events.push(event))

    adapter.sendAudio('cHJlc2VydmVk')
    adapter.commitAudio()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(events).toContainEqual({
      type: 'error',
      code: 504,
      message: expect.stringMatching(/STT.*retry/i),
    })

    adapter.commitAudio()

    expect(stt.audio).toEqual(['cHJlc2VydmVk', 'cHJlc2VydmVk'])
    expect(stt.commits).toBe(2)
  })

  it('waits as long as the recognition provider declares', async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const stt = new FakeSTT(calls)
    // A locally hosted recognizer loads models per utterance, so the pipeline
    // must not cut it off at the streaming provider's 10 second budget.
    stt.finalTranscriptDeadlineMs = 60_000
    const tts = new FakeTTS(calls)
    const events: RelayEvent[] = []
    const adapter: ProviderAdapter = new ComposedAdapter(
      stt,
      new FakeHarness(calls),
      tts,
      new OutputRouter({ tts, sendToClient: (event) => events.push(event) })
    )
    await adapter.connect(sessionConfig(), (event) => events.push(event))

    adapter.sendAudio('cHJlc2VydmVk')
    adapter.commitAudio()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(events.filter((event) => event.type === 'error')).toEqual([])

    await vi.advanceTimersByTimeAsync(50_000)
    expect(events).toContainEqual({
      type: 'error',
      code: 504,
      message: expect.stringMatching(/STT.*retry/i),
    })
  })

  it('degrades unavailable Harness features', async () => {
    const failedCalls: string[] = []
    const failedSTT = new FakeSTT(failedCalls)
    const failedHarness = new FakeHarness(failedCalls)
    failedHarness.connectError = new Error('connection refused')
    const failedTTS = new FakeTTS(failedCalls)
    const failureEvents: RelayEvent[] = []
    const failedAdapter: ProviderAdapter = new ComposedAdapter(
      failedSTT,
      failedHarness,
      failedTTS,
      new OutputRouter({
        tts: failedTTS,
        sendToClient: (event) => failureEvents.push(event),
      })
    )

    await expect(
      failedAdapter.connect(sessionConfig(), (event) => failureEvents.push(event))
    ).resolves.toBeUndefined()
    expect(failureEvents).toContainEqual({
      type: 'error',
      code: 503,
      message: expect.stringMatching(/Harness.*S2S Direct.*S2S Operator/i),
    })

    const calls: string[] = []
    const stt = new FakeSTT(calls)
    const harness = new FakeHarness(calls)
    const tts = new FakeTTS(calls)
    const adapter: ProviderAdapter = new ComposedAdapter(
      stt,
      harness,
      tts,
      new OutputRouter({ tts, sendToClient: () => {} })
    )
    await adapter.connect(sessionConfig(), () => {})
    stt.emitFinal('restart this query')
    await vi.waitFor(() => expect(harness.handles).toHaveLength(1))

    adapter.cancelResponse()

    await vi.waitFor(() => expect(harness.cancelled).toBe(1))
    expect(harness.cancelled).toBe(1)
    expect(harness.messages).toEqual([{ text: 'restart this query' }])
  })

  it('reports advisory Harness recovery guidance', async () => {
    const failedCalls: string[] = []
    const failedSTT = new FakeSTT(failedCalls)
    const failedHarness = new FakeHarness(failedCalls)
    failedHarness.connectError = new Error('connection refused')
    const failedTTS = new FakeTTS(failedCalls)
    const failureEvents: RelayEvent[] = []
    const failedAdapter: ProviderAdapter = new ComposedAdapter(
      failedSTT,
      failedHarness,
      failedTTS,
      new OutputRouter({
        tts: failedTTS,
        sendToClient: (event) => failureEvents.push(event),
      })
    )

    await failedAdapter.connect(sessionConfig(), (event) => failureEvents.push(event))

    const connectionError = failureEvents.find(
      (event): event is Extract<RelayEvent, { type: 'error' }> => event.type === 'error'
    )
    expect(connectionError?.message).toMatch(/resubmit/i)
    expect(connectionError?.message).toMatch(/S2S Direct.*mode "s2s".*voiceMode "direct"/i)
    expect(connectionError?.message).toMatch(/S2S Operator.*voiceMode "operator"/i)
    expect(failedCalls.filter((call) => call === 'harness.connect')).toHaveLength(1)

    const calls: string[] = []
    const stt = new FakeSTT(calls)
    const harness = new FakeHarness(calls)
    const tts = new FakeTTS(calls)
    const events: RelayEvent[] = []
    const adapter: ProviderAdapter = new ComposedAdapter(
      stt,
      harness,
      tts,
      new OutputRouter({ tts, sendToClient: (event) => events.push(event) })
    )
    await adapter.connect(sessionConfig(), (event) => events.push(event))
    stt.emitFinal('do not replay this query')
    await vi.waitFor(() => expect(harness.messages).toHaveLength(1))

    adapter.cancelResponse()

    await vi.waitFor(() => expect(harness.cancelled).toBe(1))
    expect(harness.messages).toEqual([{ text: 'do not replay this query' }])
    expect(events).toContainEqual({
      type: 'error',
      code: 409,
      message: expect.stringMatching(/interruption.*resubmit.*S2S Direct.*S2S Operator/i),
    })
  })
})

class FakeSTT implements STTProvider {
  readonly audio: string[] = []
  readonly configs: STTConfig[] = []
  commits = 0
  finalTranscriptDeadlineMs: number | undefined
  private partialTranscript: TranscriptCallback = () => {}
  private finalTranscript: TranscriptCallback = () => {}
  private error: (message: string) => void = () => {}

  constructor(private readonly calls: string[]) {}

  async connect(config: STTConfig): Promise<void> {
    this.configs.push(structuredClone(config))
    this.calls.push('stt.connect')
  }

  processAudio(pcmData: string): void {
    this.audio.push(pcmData)
  }

  commit(): void {
    this.commits += 1
  }

  onPartialTranscript(callback: TranscriptCallback): void {
    this.partialTranscript = callback
  }

  onFinalTranscript(callback: TranscriptCallback): void {
    this.finalTranscript = callback
  }

  onError(callback: (message: string) => void): void {
    this.error = callback
  }

  async disconnect(): Promise<void> {
    this.calls.push('stt.disconnect')
  }

  emitPartial(text: string): void {
    this.partialTranscript(text)
  }

  emitFinal(text: string): void {
    this.finalTranscript(text)
  }
}

class FakeHarness implements HarnessAdapter {
  readonly id = 'fake'
  readonly capabilities: HarnessCapabilities = {
    structuredOutput: true,
    interruption: false,
    overlay: false,
    streaming: true,
  }
  readonly messages: UserMessage[] = []
  readonly handles: StreamHandle[] = []
  output: OutputChunk[] = []
  connectError: Error | null = null
  cancelled = 0

  constructor(private readonly calls: string[]) {}

  async connect(_config: HarnessConfig): Promise<void> {
    this.calls.push('harness.connect')
    if (this.connectError) throw this.connectError
  }

  async sendMessage(message: UserMessage, onChunk: ChunkHandler): Promise<StreamHandle> {
    this.messages.push(message)
    for (const chunk of this.output) await onChunk(chunk)
    const handle = {
      cancel: () => {
        this.cancelled += 1
      },
      done: Promise.resolve(),
    }
    this.handles.push(handle)
    return handle
  }

  async disconnect(): Promise<void> {
    this.calls.push('harness.disconnect')
  }
}

class FakeTTS implements TTSProvider {
  readonly synthesized: string[] = []
  readonly configs: TTSConfig[] = []
  constructor(private readonly calls: string[]) {}

  async connect(config: TTSConfig): Promise<void> {
    this.configs.push(structuredClone(config))
    this.calls.push('tts.connect')
  }

  async *synthesize(text: string) {
    this.synthesized.push(text)
    yield { data: 'YXVkaW8=' }
  }

  getPlaybackPosition(): number {
    return 0
  }

  async stop(): Promise<void> {}

  async disconnect(): Promise<void> {
    this.calls.push('tts.disconnect')
  }
}

function sessionConfig(): SessionConfigEvent {
  return {
    type: 'session.config',
    provider: 'openai',
    voice: 'test',
    brainAgent: 'none',
    apiKey: 'test',
    mode: 'stt-tts',
    sttConfig: { model: 'nova-2' },
    ttsConfig: { voice: 'test' },
  }
}

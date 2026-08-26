import { describe, expect, it, vi } from 'vitest'
import { createAdapter } from '../../src/adapters/index.js'
import type { HarnessAdapter, HarnessConfig } from '../../src/harness-adapter/interface.js'
import type { ChunkHandler, OutputChunk, UserMessage } from '../../src/harness-adapter/types.js'
import type { STTProvider, TranscriptCallback } from '../../src/stt/interface.js'
import type { TTSProvider } from '../../src/tts/interface.js'
import type { RelayEvent, SessionConfigEvent } from '../../src/types.js'
import type { ThinkingEntry, ThinkingSaveMetadata } from '../../src/thinking/storage.js'
import {
  ClaudeCodeAdapter,
  type HarnessTransport,
} from '../../src/harness-adapter/claude-code-adapter.js'

describe('STT/TTS pipeline', () => {
  it('emits audio for recognized speech', async () => {
    const stt = new PipelineSTT('recognized request')
    const harness = new PipelineHarness([
      { type: 'speech.delta', content: 'Recognized response.' },
      { type: 'complete' },
    ])
    const tts = new PipelineTTS()
    const events: RelayEvent[] = []
    const config = sessionConfig()
    const adapter = createAdapter(config, {
      createSTTProvider: () => stt,
      createHarnessAdapter: () => harness,
      createTTSProvider: () => tts,
      sendToClient: (event) => events.push(event),
    })
    await adapter.connect(config, (event) => events.push(event))

    adapter.sendAudio('cGNt')
    adapter.commitAudio()

    await vi.waitFor(() => expect(events).toContainEqual({ type: 'audio.delta', data: 'YXVkaW8=' }))
    expect(stt.audio).toEqual(['cGNt'])
    expect(harness.messages).toEqual([{ text: 'recognized request' }])
    expect(tts.synthesized).toEqual(['Recognized response.'])
  })

  it('separates thinking speech and text', async () => {
    const privateReasoning = 'private chain of thought'
    const thinking = {
      steps: ['inspect input', 'choose response'],
      reasoning: privateReasoning,
      confidence: 0.9,
    }
    const harness = new PipelineHarness([
      { type: 'thinking.delta', content: JSON.stringify(thinking) },
      { type: 'speech.delta', content: 'Spoken summary.' },
      { type: 'text.delta', content: 'Detailed screen content', format: 'markdown' },
      {
        type: 'complete',
        output: {
          thinking,
          speech: { content: 'Spoken summary.' },
          text: { content: 'Detailed screen content', format: 'markdown' },
        },
      },
    ])
    const tts = new PipelineTTS()
    const events: RelayEvent[] = []
    const saved: ThinkingEntry[] = []
    const traced: Array<{ thinking: typeof thinking; turnId?: string }> = []
    const config = { ...sessionConfig(), sessionKey: 'session-12-2' }
    const adapter = createAdapter(config, {
      createSTTProvider: () => new PipelineSTT('private user query'),
      createHarnessAdapter: () => harness,
      createTTSProvider: () => tts,
      sendToClient: (event) => events.push(event),
      saveThinking: async (entry): Promise<ThinkingSaveMetadata> => {
        saved.push(entry)
        return {
          localPath: '/thinking/session-12-2.jsonl',
          tracePath: 'https://langfuse.example/trace/turn-12-2',
        }
      },
      attachThinking: (content, turnId) => traced.push({ thinking: content, turnId }),
    })
    await adapter.connect(config, (event) => events.push(event))

    adapter.sendAudio('cGNt')
    adapter.commitAudio()

    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toMatchObject({
      sessionId: 'session-12-2',
      thinking,
      userQuery: 'private user query',
      finalOutput: 'Detailed screen content',
    })
    expect(saved[0].turnId).toBeTruthy()
    expect(traced).toEqual([{ thinking, turnId: saved[0].turnId }])
    expect(tts.synthesized).toEqual(['Spoken summary.'])
    expect(events).toContainEqual({
      type: 'transcript.delta',
      text: 'Detailed screen content',
      role: 'assistant',
      source: 'text',
      format: 'markdown',
    })
    expect(events).toContainEqual({
      type: 'thinking.saved',
      turnId: saved[0].turnId,
      localPath: '/thinking/session-12-2.jsonl',
      tracePath: 'https://langfuse.example/trace/turn-12-2',
    })
    expect(JSON.stringify(events)).not.toContain(privateReasoning)
    expect(tts.synthesized).not.toContain(privateReasoning)
  })

  it('falls back from plain Harness output', async () => {
    const transport: HarnessTransport = {
      stream() {
        return streamHarnessText('Plain Harness response')
      },
    }
    const harness = new ClaudeCodeAdapter(transport)
    const tts = new PipelineTTS()
    const events: RelayEvent[] = []
    const config = {
      ...sessionConfig(),
      harnessConfig: { gatewayUrl: 'http://harness.test' },
    }
    const adapter = createAdapter(config, {
      createSTTProvider: () => new PipelineSTT('plain request'),
      createHarnessAdapter: () => harness,
      createTTSProvider: () => tts,
      sendToClient: (event) => events.push(event),
    })
    await adapter.connect(config, (event) => events.push(event))

    adapter.sendAudio('cGNt')
    adapter.commitAudio()

    await vi.waitFor(() => expect(tts.synthesized).toEqual(['Plain Harness response']))
    expect(events).toContainEqual({
      type: 'transcript.delta',
      text: 'Plain Harness response',
      role: 'assistant',
      source: 'text',
      format: 'plain',
    })
  })

  it('continues text after TTS failure', async () => {
    const harness = new PipelineHarness([
      { type: 'speech.delta', content: 'This synthesis fails.' },
      { type: 'text.delta', content: 'Readable fallback', format: 'plain' },
      { type: 'complete' },
    ])
    const tts = new PipelineTTS()
    tts.failWith = new Error('provider unavailable')
    const events: RelayEvent[] = []
    const config = sessionConfig()
    const adapter = createAdapter(config, {
      createSTTProvider: () => new PipelineSTT('failure request'),
      createHarnessAdapter: () => harness,
      createTTSProvider: () => tts,
      sendToClient: (event) => events.push(event),
    })
    await adapter.connect(config, (event) => events.push(event))

    adapter.sendAudio('cGNt')
    adapter.commitAudio()

    await vi.waitFor(() => expect(events).toContainEqual({ type: 'turn.ended' }))
    expect(events).toContainEqual({
      type: 'transcript.delta',
      text: 'Readable fallback',
      role: 'assistant',
      source: 'text',
      format: 'plain',
    })
    expect(events.some((event) => event.type === 'audio.delta')).toBe(false)
  })

  it('meets deterministic latency budgets', async () => {
    const fastClock = new TestClock()
    const fastTTS = new PipelineTTS(() => fastClock.now)
    const fastConfig = sessionConfig()
    const fastAdapter = createAdapter(fastConfig, {
      createSTTProvider: () => new PipelineSTT('what time is it'),
      createHarnessAdapter: () =>
        new TimedHarness(fastClock, [
          { afterMs: 2_500, chunk: { type: 'speech.delta', content: 'It is noon.' } },
          { afterMs: 0, chunk: { type: 'complete' } },
        ]),
      createTTSProvider: () => fastTTS,
    })
    await fastAdapter.connect(fastConfig, () => {})

    fastAdapter.sendAudio('cGNt')
    fastAdapter.commitAudio()

    await vi.waitFor(() => expect(fastTTS.startedAt).toEqual([2_500]))
    expect(fastTTS.startedAt[0]).toBeLessThan(3_000)

    const streamClock = new TestClock()
    const streamTTS = new PipelineTTS(() => streamClock.now)
    const streamConfig = sessionConfig()
    const firstSpeechAt = 6_000
    const streamAdapter = createAdapter(streamConfig, {
      createSTTProvider: () => new PipelineSTT('perform a long task'),
      createHarnessAdapter: () =>
        new TimedHarness(streamClock, [
          {
            afterMs: firstSpeechAt,
            chunk: { type: 'speech.delta', content: 'First streamed sentence.' },
          },
          {
            afterMs: 4_000,
            chunk: { type: 'speech.delta', content: 'Second streamed sentence.' },
          },
          { afterMs: 0, chunk: { type: 'complete' } },
        ]),
      createTTSProvider: () => streamTTS,
    })
    await streamAdapter.connect(streamConfig, () => {})

    streamAdapter.sendAudio('cGNt')
    streamAdapter.commitAudio()

    await vi.waitFor(() => expect(streamTTS.startedAt).toHaveLength(2))
    expect(streamTTS.startedAt[0] - firstSpeechAt).toBeLessThan(2_000)
    expect(streamTTS.startedAt[0]).toBeLessThan(streamClock.now)
  })

  it('reports asynchronous Harness stream failures', async () => {
    const events: RelayEvent[] = []
    const config = sessionConfig()
    const adapter = createAdapter(config, {
      createSTTProvider: () => new PipelineSTT('failing Harness request'),
      createHarnessAdapter: () => new RejectingHarness(),
      createTTSProvider: () => new PipelineTTS(),
      sendToClient: (event) => events.push(event),
    })
    await adapter.connect(config, (event) => events.push(event))

    adapter.sendAudio('cGNt')
    adapter.commitAudio()

    await vi.waitFor(() =>
      expect(events).toContainEqual({
        type: 'error',
        code: 502,
        message: 'Harness request failed: stream disconnected. Try S2S mode',
      })
    )
    expect(events).toContainEqual({ type: 'turn.ended' })
  })

  it('captures streamed thinking without complete output', async () => {
    const thinking = { steps: ['inspect'], reasoning: 'private streamed reasoning' }
    const saved: ThinkingEntry[] = []
    const config = { ...sessionConfig(), sessionKey: 'streamed-thinking-session' }
    const adapter = createAdapter(config, {
      createSTTProvider: () => new PipelineSTT('streamed thinking request'),
      createHarnessAdapter: () =>
        new PipelineHarness([
          { type: 'thinking.delta', content: JSON.stringify(thinking) },
          { type: 'speech.delta', content: 'Public summary.' },
          { type: 'text.delta', content: 'Public details' },
          { type: 'complete' },
        ]),
      createTTSProvider: () => new PipelineTTS(),
      saveThinking: async (entry) => {
        saved.push(entry)
        return null
      },
    })
    await adapter.connect(config, () => {})

    adapter.sendAudio('cGNt')
    adapter.commitAudio()

    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toMatchObject({
      thinking,
      userQuery: 'streamed thinking request',
      finalOutput: 'Public details',
    })
  })
})

class PipelineSTT implements STTProvider {
  readonly audio: string[] = []
  private partialTranscript: TranscriptCallback = () => {}
  private finalTranscript: TranscriptCallback = () => {}
  private error: (message: string) => void = () => {}

  constructor(private readonly recognizedText: string) {}

  async connect() {}

  processAudio(data: string): void {
    this.audio.push(data)
  }

  commit(): void {
    this.finalTranscript(this.recognizedText)
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

  async disconnect() {}
}

class PipelineHarness implements HarnessAdapter {
  readonly id = 'fake'
  readonly capabilities = {
    structuredOutput: true as const,
    interruption: false,
    overlay: false,
    streaming: true,
  }
  readonly messages: UserMessage[] = []
  connectedConfig: HarnessConfig | null = null

  constructor(private readonly chunks: OutputChunk[]) {}

  async connect(config: HarnessConfig) {
    this.connectedConfig = config
  }

  async sendMessage(message: UserMessage, onChunk: ChunkHandler) {
    this.messages.push(message)
    for (const chunk of this.chunks) await onChunk(chunk)
    return { cancel: () => {}, done: Promise.resolve() }
  }

  async disconnect() {}
}

class PipelineTTS implements TTSProvider {
  readonly synthesized: string[] = []
  readonly startedAt: number[] = []
  failWith: Error | null = null

  constructor(private readonly now: () => number = Date.now) {}

  async connect() {}

  async *synthesize(text: string) {
    this.synthesized.push(text)
    this.startedAt.push(this.now())
    if (this.failWith) throw this.failWith
    yield { data: 'YXVkaW8=' }
  }

  getPlaybackPosition() {
    return 0
  }

  async stop() {}
  async disconnect() {}
}

class TimedHarness implements HarnessAdapter {
  readonly id = 'timed'
  readonly capabilities = {
    structuredOutput: true as const,
    interruption: false,
    overlay: false,
    streaming: true,
  }

  constructor(
    private readonly clock: TestClock,
    private readonly script: Array<{ afterMs: number; chunk: OutputChunk }>
  ) {}

  async connect() {}

  async sendMessage(_message: UserMessage, onChunk: ChunkHandler) {
    for (const item of this.script) {
      this.clock.advance(item.afterMs)
      await onChunk(item.chunk)
    }
    return { cancel: () => {}, done: Promise.resolve() }
  }

  async disconnect() {}
}

class RejectingHarness implements HarnessAdapter {
  readonly id = 'rejecting'
  readonly capabilities = {
    structuredOutput: true as const,
    interruption: false,
    overlay: false,
    streaming: true,
  }

  async connect() {}

  async sendMessage() {
    return {
      cancel: () => {},
      done: Promise.reject(new Error('stream disconnected')),
    }
  }

  async disconnect() {}
}

class TestClock {
  now = 0

  advance(ms: number): void {
    this.now += ms
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
    sttProvider: 'deepgram',
    harness: 'claude-code',
    ttsProvider: 'elevenlabs',
  }
}

async function* streamHarnessText(content: string): AsyncIterable<string> {
  yield content
}

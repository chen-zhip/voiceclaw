import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RelaySession } from '../../src/session.js'
import type { AdapterFactoryDependencies } from '../../src/adapters/index.js'
import type { ProviderAdapter, SendToClient } from '../../src/adapters/types.js'
import type { ClientEvent, RelayEvent, SessionConfigEvent } from '../../src/types.js'

const originalUnauthenticated = process.env.RELAY_ALLOW_UNAUTHENTICATED

describe('RelaySession STT/TTS mode', () => {
  beforeEach(() => {
    process.env.RELAY_ALLOW_UNAUTHENTICATED = 'true'
  })

  afterEach(() => {
    if (originalUnauthenticated === undefined) {
      delete process.env.RELAY_ALLOW_UNAUTHENTICATED
    } else {
      process.env.RELAY_ALLOW_UNAUTHENTICATED = originalUnauthenticated
    }
  })

  it('dispatches composed sessions', async () => {
    const socket = new FakeSocket()
    const adapter = new RecordingAdapter()
    const selected: SessionConfigEvent[] = []
    new RelaySession(
      socket as never,
      (config: SessionConfigEvent, _dependencies?: AdapterFactoryDependencies) => {
        selected.push(config)
        return adapter
      }
    )

    await socket.deliver(
      sessionConfig({
        mode: 'stt-tts',
        sttProvider: 'deepgram',
        ttsProvider: 'elevenlabs',
        harness: 'claude-code',
      })
    )
    await socket.deliver({ type: 'audio.append', data: 'cGNt' })
    await socket.deliver({ type: 'audio.commit' })

    expect(selected).toHaveLength(1)
    expect(selected[0].mode).toBe('stt-tts')
    expect(adapter.audio).toEqual(['cGNt'])
    expect(adapter.commits).toBe(1)
    expect(socket.sent).toEqual(
      expect.arrayContaining([
        { type: 'thinking.saved', localPath: 'thinking.jsonl', tracePath: 'trace-url' },
        {
          type: 'text.section',
          sectionId: 'results',
          content: 'Details',
          format: 'markdown',
        },
        { type: 'screen.highlight', target: 'results', mode: 'look' },
        expect.objectContaining({ type: 'session.ready' }),
      ])
    )
  })

  it('preserves older clients', async () => {
    const socket = new FakeSocket()
    const adapter = new RecordingAdapter(false)
    const selected: SessionConfigEvent[] = []
    new RelaySession(socket as never, (config: SessionConfigEvent) => {
      selected.push(config)
      return adapter
    })

    await socket.deliver(sessionConfig())
    await socket.deliver({ type: 'audio.append', data: 'bGVnYWN5' })

    expect(selected[0].mode).toBe('s2s')
    expect(adapter.audio).toEqual(['bGVnYWN5'])
    expect(
      socket.sent.some((event) =>
        ['thinking.saved', 'text.section', 'screen.highlight'].includes(event.type)
      )
    ).toBe(false)
    expect(socket.sent).toContainEqual(expect.objectContaining({ type: 'session.ready' }))
  })

  it('binds implicit session IDs to composed configuration', async () => {
    const socket = new FakeSocket()
    const selected: SessionConfigEvent[] = []
    const session = new RelaySession(socket as never, (config: SessionConfigEvent) => {
      selected.push(config)
      return new RecordingAdapter(false)
    })

    await socket.deliver(
      sessionConfig({
        mode: 'stt-tts',
        sttProvider: 'deepgram',
        ttsProvider: 'elevenlabs',
        harness: 'claude-code',
      })
    )

    expect(selected[0].sessionKey).toBe(session.id)
  })

  it('routes authenticated thinking deletion requests to storage', async () => {
    const socket = new FakeSocket()
    const deleteSession = vi.fn(async () => {})
    const wipe = vi.fn(async () => {})
    const SessionWithThinkingData = RelaySession as unknown as new (
      socket: never,
      factory: typeof createRecordingAdapter,
      thinkingData: { deleteSession: typeof deleteSession; wipe: typeof wipe }
    ) => RelaySession
    new SessionWithThinkingData(socket as never, createRecordingAdapter, { deleteSession, wipe })

    await socket.deliver(sessionConfig())
    await socket.deliver({ type: 'thinking.delete', sessionId: 'archived-session' })
    await socket.deliver({ type: 'thinking.wipe' })

    expect(deleteSession).toHaveBeenCalledWith('archived-session')
    expect(wipe).toHaveBeenCalledOnce()
  })
})

function createRecordingAdapter(): ProviderAdapter {
  return new RecordingAdapter(false)
}

class RecordingAdapter implements ProviderAdapter {
  readonly capabilities = { blockingToolResponse: false }
  readonly audio: string[] = []
  commits = 0

  constructor(private readonly emitStructuredEvents = true) {}

  async connect(_config: SessionConfigEvent, sendToClient: SendToClient): Promise<void> {
    if (!this.emitStructuredEvents) return
    sendToClient({
      type: 'thinking.saved',
      localPath: 'thinking.jsonl',
      tracePath: 'trace-url',
    })
    sendToClient({
      type: 'text.section',
      sectionId: 'results',
      content: 'Details',
      format: 'markdown',
    })
    sendToClient({ type: 'screen.highlight', target: 'results', mode: 'look' })
  }

  sendAudio(data: string): void {
    this.audio.push(data)
  }

  commitAudio(): void {
    this.commits += 1
  }

  sendFrame(): void {}
  createResponse(): void {}
  cancelResponse(): void {}
  sendToolResult(): void {}
  injectContext(): void {}
  getTranscript() {
    return []
  }
  disconnect(): void {}
}

class FakeSocket {
  readonly OPEN = 1
  readonly readyState = 1
  readonly sent: RelayEvent[] = []
  private messageHandler: ((raw: unknown) => Promise<void>) | null = null

  send(data: string): void {
    this.sent.push(JSON.parse(data) as RelayEvent)
  }

  close(): void {}

  on(event: string, listener: (raw: unknown) => Promise<void>): void {
    if (event === 'message') this.messageHandler = listener
  }

  async deliver(event: ClientEvent | { type: string; sessionId?: string }): Promise<void> {
    if (!this.messageHandler) throw new Error('message handler not registered')
    await this.messageHandler(JSON.stringify(event))
  }
}

function sessionConfig(overrides: Partial<SessionConfigEvent> = {}): SessionConfigEvent {
  return {
    type: 'session.config',
    provider: 'openai',
    voice: 'test',
    brainAgent: 'none',
    apiKey: 'test',
    ...overrides,
  }
}

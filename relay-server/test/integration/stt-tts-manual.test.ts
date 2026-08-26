import { WebSocket, WebSocketServer } from 'ws'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { RelaySession } from '../../src/session.js'
import { createAdapter } from '../../src/adapters/index.js'
import type { HarnessAdapter, HarnessConfig } from '../../src/harness-adapter/interface.js'
import type { ChunkHandler, UserMessage } from '../../src/harness-adapter/types.js'
import type { STTProvider, TranscriptCallback } from '../../src/stt/interface.js'
import type { TTSProvider } from '../../src/tts/interface.js'
import type { RelayEvent, SessionConfigEvent } from '../../src/types.js'

const originalUnauthenticated = process.env.RELAY_ALLOW_UNAUTHENTICATED

beforeEach(() => {
  process.env.RELAY_ALLOW_UNAUTHENTICATED = 'true'
})

afterEach(() => {
  if (originalUnauthenticated === undefined) delete process.env.RELAY_ALLOW_UNAUTHENTICATED
  else process.env.RELAY_ALLOW_UNAUTHENTICATED = originalUnauthenticated
})

it('manually connects to STT/TTS mode over WebSocket', async () => {
  const server = new WebSocketServer({ port: 0 })
  server.on('connection', (socket) => {
    new RelaySession(socket, (config, dependencies) =>
      createAdapter(config, {
        ...dependencies,
        createSTTProvider: () => new ManualSTT(),
        createHarnessAdapter: () => new ManualHarness(config.voice === 'harness-failure'),
        createTTSProvider: () => new ManualTTS(config.voice === 'failure'),
      })
    )
  })

  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (typeof address === 'string') throw new Error('Expected a TCP address')

  const successful = await runSession(address.port, 'success')
  const degraded = await runSession(address.port, 'failure')
  const harnessFailure = await runSession(address.port, 'harness-failure')

  expect(successful.some((event) => event.type === 'audio.delta')).toBe(true)
  expect(successful.some((event) => event.type === 'text.section')).toBe(true)
  expect(degraded.some((event) => event.type === 'transcript.delta')).toBe(true)
  expect(degraded.some((event) => event.type === 'turn.ended')).toBe(true)
  expect(degraded.some((event) => event.type === 'audio.delta')).toBe(false)
  expect(harnessFailure).toContainEqual({
    type: 'error',
    code: 502,
    message: 'Harness request failed: manual Harness failure. Try S2S mode',
  })
  expect(harnessFailure.some((event) => event.type === 'turn.ended')).toBe(true)

  console.log(
    JSON.stringify({
      pipeline: successful.map((event) => event.type),
      structuredText: successful.find((event) => event.type === 'text.section'),
      providerFailure: degraded.map((event) => event.type),
      harnessFailure: harnessFailure.map((event) => event.type),
    })
  )

  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
})

class ManualSTT implements STTProvider {
  private finalTranscript: TranscriptCallback = () => {}

  async connect() {}
  processAudio() {}

  commit(): void {
    this.finalTranscript('manual request')
  }

  onPartialTranscript() {}

  onFinalTranscript(callback: TranscriptCallback): void {
    this.finalTranscript = callback
  }

  onError() {}
  async disconnect() {}
}

class ManualHarness implements HarnessAdapter {
  readonly id = 'manual'
  readonly capabilities = {
    structuredOutput: true as const,
    interruption: false,
    overlay: false,
    streaming: true,
  }

  constructor(private readonly fail: boolean) {}

  async connect(_config: HarnessConfig) {}

  async sendMessage(_message: UserMessage, onChunk: ChunkHandler) {
    if (this.fail) {
      return {
        cancel: () => {},
        done: Promise.reject(new Error('manual Harness failure')),
      }
    }
    await onChunk({ type: 'speech.delta', content: 'Manual spoken answer.' })
    await onChunk({
      type: 'text.delta',
      content: 'Manual details',
      format: 'markdown',
      sections: [{ id: 'manual-details', content: 'Manual details' }],
    })
    await onChunk({ type: 'complete' })
    return { cancel: () => {}, done: Promise.resolve() }
  }

  async disconnect() {}
}

class ManualTTS implements TTSProvider {
  constructor(private readonly fail: boolean) {}

  async connect() {}

  async *synthesize() {
    if (this.fail) throw new Error('manual provider failure')
    yield { data: 'YXVkaW8=' }
  }

  getPlaybackPosition() {
    return 0
  }

  async stop() {}
  async disconnect() {}
}

function runSession(port: number, voice: string): Promise<RelayEvent[]> {
  return new Promise((resolve, reject) => {
    const events: RelayEvent[] = []
    const client = new WebSocket(`ws://127.0.0.1:${port}`)
    client.on('open', () => client.send(JSON.stringify(sessionConfig(voice))))
    client.on('message', (raw) => {
      const event = JSON.parse(raw.toString()) as RelayEvent
      events.push(event)
      if (event.type === 'session.ready') {
        client.send(JSON.stringify({ type: 'audio.append', data: 'cGNt' }))
        client.send(JSON.stringify({ type: 'audio.commit' }))
      }
      if (event.type === 'turn.ended') {
        client.close()
        resolve(events)
      }
    })
    client.on('error', reject)
  })
}

function sessionConfig(voice: string): SessionConfigEvent {
  return {
    type: 'session.config',
    provider: 'openai',
    voice,
    brainAgent: 'none',
    apiKey: 'manual',
    mode: 'stt-tts',
    sttProvider: 'deepgram',
    harness: 'claude-code',
    ttsProvider: 'elevenlabs',
  }
}

import { createServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProviderAdapter } from '../../src/adapters/types.js'
import { DesktopHostConnectionGateway } from '../../src/desktop-host/host-connection.js'
import { ControlStateStore } from '../../src/plugin-kernel/control-state-store.js'
import { createRelayServer } from '../../src/server-factory.js'
import { RelaySession } from '../../src/session.js'
import { __resetShutdownStateForTests } from '../../src/shutdown.js'
import { mountRelayWebSocketGateways } from '../../src/websocket-gateways.js'

const originalEnv = {
  allowUnauthenticated: process.env.RELAY_ALLOW_UNAUTHENTICATED,
  brainGatewayUrl: process.env.BRAIN_GATEWAY_URL,
}

describe('STT/TTS Harness Memory fallback', () => {
  beforeEach(() => {
    process.env.RELAY_ALLOW_UNAUTHENTICATED = 'true'
    __resetShutdownStateForTests()
  })

  afterEach(() => {
    restoreEnv('RELAY_ALLOW_UNAUTHENTICATED', originalEnv.allowUnauthenticated)
    restoreEnv('BRAIN_GATEWAY_URL', originalEnv.brainGatewayUrl)
    __resetShutdownStateForTests()
  })

  it('does not persist Harness transcript through Brain', async () => {
    let brainRequests = 0
    const brain = createServer((_request, response) => {
      brainRequests += 1
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('data: {"choices":[{"delta":{"content":"stored"}}]}\n\ndata: [DONE]\n\n')
    })
    await listen(brain)
    process.env.BRAIN_GATEWAY_URL = `http://127.0.0.1:${(brain.address() as AddressInfo).port}`

    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-session-memory-fallback-'))
    const store = await ControlStateStore.open(join(directory, 'control-state.json'), {
      requester: { kind: 'relay-authority', id: 'test' },
    })
    const { server } = createRelayServer((_request, response) => response.end(), {})
    const mounted = mountRelayWebSocketGateways(server, {
      hostGateway: new DesktopHostConnectionGateway(store),
      onClientConnection: (socket) => {
        new RelaySession(socket, () => transcriptAdapter())
      },
    })
    await listen(server)
    const client = await connect(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`)

    try {
      const ready = nextMessage(client)
      client.send(
        JSON.stringify({
          type: 'session.config',
          provider: 'openai',
          voice: 'test',
          brainAgent: 'none',
          apiKey: 'test',
          mode: 'stt-tts',
          sttProvider: 'deepgram',
          ttsProvider: 'elevenlabs',
          harness: 'fixture',
        })
      )
      await ready
      client.close(1000)
      await closed(client)
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(brainRequests).toBe(0)
    } finally {
      client.terminate()
      mounted.clientWebSocketServer.close()
      mounted.hostWebSocketServer.close()
      server.closeAllConnections()
      await close(server)
      await close(brain)
    }
  })
})

function transcriptAdapter(): ProviderAdapter {
  return {
    capabilities: { blockingToolResponse: false },
    async connect() {},
    sendAudio() {},
    commitAudio() {},
    sendFrame() {},
    createResponse() {},
    cancelResponse() {},
    sendToolResult() {},
    injectContext() {},
    getTranscript: () => [
      { role: 'user', text: 'Remember me' },
      { role: 'assistant', text: 'Harness answer' },
    ],
    disconnect() {},
  }
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) =>
    socket.once('message', (data) => resolve(JSON.parse(data.toString())))
  )
}

function closed(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve()
  return new Promise((resolve) => socket.once('close', () => resolve()))
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

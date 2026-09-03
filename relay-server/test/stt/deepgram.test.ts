import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import WebSocket, { WebSocketServer } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepgramSTTProvider } from '../../src/stt/deepgram.js'

interface DeepgramFixture {
  url: string
  requests: { url?: string; authorization?: string }[]
  messages: Buffer[]
  socket: WebSocket | null
  close(): Promise<void>
}

async function createDeepgramFixture(): Promise<DeepgramFixture> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  const requests: DeepgramFixture['requests'] = []
  const messages: Buffer[] = []
  const fixture: DeepgramFixture = {
    url: '',
    requests,
    messages,
    socket: null,
    async close() {
      for (const client of server.clients) client.terminate()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }

  server.on('connection', (socket, request) => {
    fixture.socket = socket
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
    })
    socket.on('message', (data) => messages.push(Buffer.from(data as Buffer)))
  })

  await once(server, 'listening')
  const address = server.address() as AddressInfo
  fixture.url = `ws://127.0.0.1:${address.port}`
  return fixture
}

const fixtures: DeepgramFixture[] = []
const providers: DeepgramSTTProvider[] = []

afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.disconnect()))
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()))
  vi.restoreAllMocks()
})

describe('DeepgramSTTProvider', () => {
  it('connects with recognition settings and flushes audio buffered before connection', async () => {
    const fixture = await createDeepgramFixture()
    fixtures.push(fixture)
    const provider = new DeepgramSTTProvider(fixture.url)
    providers.push(provider)

    provider.processAudio(Buffer.from('early audio').toString('base64'))
    await provider.connect({
      apiKey: 'deepgram-test-key',
      model: 'nova-test',
      language: 'zh-CN',
      sampleRate: 24_000,
      endpointingMs: 450,
    })

    await vi.waitFor(() => expect(fixture.messages).toHaveLength(1))
    expect(fixture.messages[0].toString()).toBe('early audio')
    expect(fixture.requests[0].authorization).toBe('Token deepgram-test-key')

    const query = new URL(fixture.requests[0].url!, fixture.url).searchParams
    expect(Object.fromEntries(query)).toMatchObject({
      model: 'nova-test',
      language: 'zh-CN',
      encoding: 'linear16',
      sample_rate: '24000',
      interim_results: 'true',
      vad_events: 'true',
      endpointing: '450',
    })
  })

  it('emits partial text and joins final segments when Deepgram ends an utterance', async () => {
    const fixture = await createDeepgramFixture()
    fixtures.push(fixture)
    const provider = new DeepgramSTTProvider(fixture.url)
    providers.push(provider)
    const partial = vi.fn()
    const final = vi.fn()
    provider.onPartialTranscript(partial)
    provider.onFinalTranscript(final)

    await provider.connect({ apiKey: 'deepgram-test-key' })
    fixture.socket!.send(
      JSON.stringify({
        type: 'Results',
        is_final: false,
        channel: { alternatives: [{ transcript: '  working  ' }] },
      })
    )
    fixture.socket!.send(
      JSON.stringify({
        type: 'Results',
        is_final: true,
        speech_final: false,
        channel: { alternatives: [{ transcript: 'hello' }] },
      })
    )
    fixture.socket!.send(
      JSON.stringify({
        type: 'Results',
        is_final: true,
        speech_final: true,
        channel: { alternatives: [{ transcript: 'world' }] },
      })
    )

    await vi.waitFor(() => expect(final).toHaveBeenCalledWith('hello world'))
    expect(partial).toHaveBeenCalledOnce()
    expect(partial).toHaveBeenCalledWith('working')
  })

  it('ignores empty recognition results and finalizes accumulated text on UtteranceEnd', async () => {
    const fixture = await createDeepgramFixture()
    fixtures.push(fixture)
    const provider = new DeepgramSTTProvider(fixture.url)
    providers.push(provider)
    const partial = vi.fn()
    const final = vi.fn()
    provider.onPartialTranscript(partial)
    provider.onFinalTranscript(final)

    await provider.connect({ apiKey: 'deepgram-test-key' })
    fixture.socket!.send(
      JSON.stringify({
        type: 'Results',
        is_final: false,
        channel: { alternatives: [{ transcript: '   ' }] },
      })
    )
    fixture.socket!.send(
      JSON.stringify({
        type: 'Results',
        is_final: true,
        channel: { alternatives: [{ transcript: 'final words' }] },
      })
    )
    fixture.socket!.send(JSON.stringify({ type: 'UtteranceEnd' }))

    await vi.waitFor(() => expect(final).toHaveBeenCalledWith('final words'))
    expect(partial).not.toHaveBeenCalled()
  })

  it('caps pre-connection buffering and closes an active Deepgram stream', async () => {
    const fixture = await createDeepgramFixture()
    fixtures.push(fixture)
    const provider = new DeepgramSTTProvider(fixture.url)
    providers.push(provider)
    const audio = Buffer.from('chunk').toString('base64')
    for (let index = 0; index < 205; index += 1) provider.processAudio(audio)

    await provider.connect({ apiKey: 'deepgram-test-key' })
    await vi.waitFor(() => expect(fixture.messages).toHaveLength(200))
    await provider.disconnect()
    await vi.waitFor(() => expect(fixture.messages).toHaveLength(201))

    expect(fixture.messages[200].toString()).toBe(JSON.stringify({ type: 'CloseStream' }))
  })

  it('commits the utterance with an empty frame and reports upstream errors', async () => {
    const fixture = await createDeepgramFixture()
    fixtures.push(fixture)
    const provider = new DeepgramSTTProvider(fixture.url)
    providers.push(provider)
    const onError = vi.fn()
    provider.onError(onError)

    await provider.connect({ apiKey: 'deepgram-test-key' })
    provider.commit()
    fixture.socket!.send(JSON.stringify({ type: 'Error', description: 'bad audio' }))

    await vi.waitFor(() => expect(fixture.messages).toHaveLength(1))
    expect(fixture.messages[0]).toHaveLength(0)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Deepgram error: bad audio'))
  })

  it('rejects a missing API key with setup instructions', async () => {
    const previousKey = process.env.DEEPGRAM_API_KEY
    delete process.env.DEEPGRAM_API_KEY
    const provider = new DeepgramSTTProvider('ws://127.0.0.1:1')
    providers.push(provider)

    try {
      await provider.connect({})
      throw new Error('expected connect to reject')
    } catch (error) {
      expect(error).toMatchObject({
        userMessage: expect.stringContaining('Set DEEPGRAM_API_KEY'),
        actionUrl: 'https://console.deepgram.com/',
        actionLabel: 'Get a Deepgram API key',
      })
    } finally {
      if (previousKey === undefined) delete process.env.DEEPGRAM_API_KEY
      else process.env.DEEPGRAM_API_KEY = previousKey
    }
  })

  it('turns a rejected WebSocket upgrade into an actionable connection error', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(401, { 'Content-Type': 'text/plain' })
      response.end('invalid token')
    })
    await listen(server)
    const address = server.address() as AddressInfo
    const provider = new DeepgramSTTProvider(`ws://127.0.0.1:${address.port}`)
    providers.push(provider)

    try {
      await provider.connect({ apiKey: 'invalid' })
      throw new Error('expected connect to reject')
    } catch (error) {
      expect(error).toMatchObject({
        httpStatus: 401,
        bodyExcerpt: 'invalid token',
        userMessage: 'Deepgram rejected the API key. Check DEEPGRAM_API_KEY.',
      })
    } finally {
      await closeServer(server)
    }
  })

  it('turns a socket connection failure into an actionable error and notifies the callback', async () => {
    const server = createServer()
    await listen(server)
    const address = server.address() as AddressInfo
    await closeServer(server)
    const provider = new DeepgramSTTProvider(`ws://127.0.0.1:${address.port}`)
    providers.push(provider)
    const onError = vi.fn()
    provider.onError(onError)

    await expect(provider.connect({ apiKey: 'test-key' })).rejects.toMatchObject({
      userMessage: expect.stringContaining('Could not reach Deepgram'),
    })
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Deepgram connection error'))
  })
})

async function listen(server: Server): Promise<void> {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

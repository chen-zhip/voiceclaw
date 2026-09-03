import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElevenLabsTTSProvider } from '../../src/tts/elevenlabs.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ElevenLabsTTSProvider', () => {
  it('streams PCM chunks with the configured voice, model, sample rate, and speed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(audioResponse([Uint8Array.from([1, 2, 3]), Uint8Array.from([4, 5])]))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new ElevenLabsTTSProvider('https://elevenlabs.test/v1/text-to-speech')
    await provider.connect({
      apiKey: 'elevenlabs-test-key',
      voice: 'Voice With Spaces',
      model: 'model-test',
      sampleRate: 16_000,
      speed: 0.9,
    })

    const chunks = []
    for await (const chunk of provider.synthesize('hello', { speed: 1.2 })) chunks.push(chunk)

    expect(chunks).toEqual([
      { data: Buffer.from([1, 2, 3]).toString('base64') },
      { data: Buffer.from([4, 5]).toString('base64') },
    ])
    expect(provider.getPlaybackPosition()).toBe(5)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://elevenlabs.test/v1/text-to-speech/Voice%20With%20Spaces/stream?output_format=pcm_16000'
    )
    expect(init.headers).toMatchObject({
      'xi-api-key': 'elevenlabs-test-key',
      'Content-Type': 'application/json',
      Accept: 'audio/pcm',
    })
    expect(JSON.parse(init.body as string)).toEqual({
      text: 'hello',
      model_id: 'model-test',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        speed: 1.2,
      },
    })
  })

  it('falls back to PCM 24000 for an unsupported sample rate', async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse([Uint8Array.from([1])]))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new ElevenLabsTTSProvider('https://elevenlabs.test/v1/text-to-speech')
    await provider.connect({ apiKey: 'test-key', sampleRate: 48_000 })

    for await (const _chunk of provider.synthesize('hi')) {
      void _chunk
    }

    expect(fetchMock.mock.calls[0][0]).toContain('output_format=pcm_24000')
  })

  it('aborts in-flight synthesis without surfacing a network error', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const signal = init?.signal
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true })
          },
        }),
        { status: 200 }
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = new ElevenLabsTTSProvider('https://elevenlabs.test/v1/text-to-speech')
    await provider.connect({ apiKey: 'test-key' })
    const iterator = provider.synthesize('cancel me')[Symbol.asyncIterator]()

    const pending = iterator.next()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await provider.stop()

    await expect(pending).resolves.toEqual({ done: true, value: undefined })
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true)
    expect(provider.getPlaybackPosition()).toBe(0)
  })

  it.each([
    [401, 'invalid', 'rejected the API key'],
    [403, 'forbidden', 'synthesis failed (HTTP 403)'],
    [422, 'bad voice', 'configured voice ID and model'],
    [429, 'quota', 'rate limit or quota'],
    [500, 'unavailable', 'synthesis failed (HTTP 500)'],
  ])('turns HTTP %s into an actionable error', async (status, body, expectedMessage) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })))
    const provider = new ElevenLabsTTSProvider('https://elevenlabs.test/v1/text-to-speech')
    await provider.connect({ apiKey: 'test-key' })

    const result = collect(provider.synthesize('hello'))

    await expect(result).rejects.toMatchObject({
      httpStatus: status,
      bodyExcerpt: body,
      userMessage: expect.stringContaining(expectedMessage),
    })
  })

  it('turns fetch failures into a graceful speech-unavailable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')))
    const provider = new ElevenLabsTTSProvider('https://elevenlabs.test/v1/text-to-speech')
    await provider.connect({ apiKey: 'test-key' })

    await expect(collect(provider.synthesize('hello'))).rejects.toMatchObject({
      message: 'ElevenLabs request failed: connection refused',
      userMessage: expect.stringContaining('Speech output is unavailable'),
    })
  })

  it('rejects an empty audio stream and calls made before connect', async () => {
    const provider = new ElevenLabsTTSProvider('https://elevenlabs.test/v1/text-to-speech')
    await expect(collect(provider.synthesize('hello'))).rejects.toThrow(/before connect/)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    await provider.connect({ apiKey: 'test-key' })
    await expect(collect(provider.synthesize('hello'))).rejects.toMatchObject({
      userMessage: 'ElevenLabs returned no audio for this utterance.',
    })
  })

  it('rejects a missing API key with setup instructions and resets state on disconnect', async () => {
    const previousKey = process.env.ELEVENLABS_API_KEY
    delete process.env.ELEVENLABS_API_KEY
    const provider = new ElevenLabsTTSProvider('https://elevenlabs.test/v1/text-to-speech')

    try {
      await expect(provider.connect({})).rejects.toMatchObject({
        userMessage: expect.stringContaining('Set ELEVENLABS_API_KEY'),
        actionUrl: 'https://elevenlabs.io/app/settings/api-keys',
        actionLabel: 'Get an ElevenLabs API key',
      })
    } finally {
      if (previousKey === undefined) delete process.env.ELEVENLABS_API_KEY
      else process.env.ELEVENLABS_API_KEY = previousKey
    }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(audioResponse([Uint8Array.from([1])])))
    await provider.connect({ apiKey: 'test-key' })
    await collect(provider.synthesize('hello'))
    expect(provider.getPlaybackPosition()).toBe(5)
    await provider.disconnect()
    expect(provider.getPlaybackPosition()).toBe(0)
    await expect(collect(provider.synthesize('again'))).rejects.toThrow(/before connect/)
  })
})

function audioResponse(chunks: Uint8Array[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }),
    { status: 200 }
  )
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of iterable) values.push(value)
  return values
}

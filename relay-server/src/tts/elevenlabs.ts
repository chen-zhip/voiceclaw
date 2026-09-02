// Requests PCM16 rather than the default mp3 so audio chunks match the
// AudioChunk contract and can be forwarded to the client without transcoding.
// Synthesis is per-call: the output router submits one sentence batch at a
// time, so a single AbortController per call is enough for barge-in.

import { log, error as logError } from '../log.js'
import type { AudioChunk, SynthesizeOptions, TTSConfig, TTSProvider } from './interface.js'

export class ElevenLabsTTSProvider implements TTSProvider {
  private config: TTSConfig | null = null
  private apiKey: string | null = null
  private playbackPosition = 0
  private abortController: AbortController | null = null

  constructor(private readonly baseUrlOverride?: string) {}

  async connect(config: TTSConfig): Promise<void> {
    const apiKey = config.apiKey ?? process.env.ELEVENLABS_API_KEY
    if (!apiKey) {
      throw Object.assign(new Error('ELEVENLABS_API_KEY not set'), {
        userMessage:
          'ElevenLabs API key missing. Set ELEVENLABS_API_KEY on the relay or send ttsConfig.apiKey in session.config.',
        actionUrl: 'https://elevenlabs.io/app/settings/api-keys',
        actionLabel: 'Get an ElevenLabs API key',
      })
    }

    this.config = config
    this.apiKey = apiKey
    this.playbackPosition = 0
    log(
      `[elevenlabs] ready (voice=${config.voice ?? DEFAULT_VOICE_ID}, model=${config.model ?? DEFAULT_MODEL})`
    )
  }

  async *synthesize(text: string, options?: SynthesizeOptions): AsyncIterable<AudioChunk> {
    const config = this.config
    const apiKey = this.apiKey
    if (!config || !apiKey) {
      throw new Error('ElevenLabsTTSProvider.synthesize called before connect')
    }
    const controller = new AbortController()
    this.abortController = controller
    try {
      const response = await this.requestAudio(text, options, controller, config, apiKey)
      yield* this.readAudio(response, text, controller)
    } finally {
      if (this.abortController === controller) this.abortController = null
    }
  }

  getPlaybackPosition(): number {
    return this.playbackPosition
  }

  async stop(): Promise<void> {
    this.abortController?.abort()
    this.abortController = null
  }

  async disconnect(): Promise<void> {
    await this.stop()
    this.config = null
    this.apiKey = null
    this.playbackPosition = 0
  }

  private async requestAudio(
    text: string,
    options: SynthesizeOptions | undefined,
    controller: AbortController,
    config: TTSConfig,
    apiKey: string
  ): Promise<Response> {
    const voice = config.voice ?? DEFAULT_VOICE_ID
    const base = this.baseUrlOverride ?? ELEVENLABS_STREAM_URL
    const url = `${base}/${encodeURIComponent(voice)}/stream?output_format=${this.outputFormat(config)}`
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/pcm',
        },
        body: JSON.stringify({
          text,
          model_id: config.model ?? DEFAULT_MODEL,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            speed: options?.speed ?? config.speed ?? 1.0,
          },
        }),
        signal: controller.signal,
      })
    } catch (err) {
      if (controller.signal.aborted) throw controller.signal.reason
      throw this.wrapNetworkError(err)
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw this.wrapHttpError(response.status, body)
    }
    if (!response.body) {
      throw Object.assign(new Error('ElevenLabs returned an empty stream'), {
        userMessage: 'ElevenLabs returned no audio for this utterance.',
      })
    }
    return response
  }

  private async *readAudio(
    response: Response,
    text: string,
    controller: AbortController
  ): AsyncIterable<AudioChunk> {
    const reader = response.body!.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value || value.length === 0) continue
        yield { data: Buffer.from(value).toString('base64') }
      }
      // ElevenLabs does not expose character timestamps for PCM chunks.
      this.playbackPosition += text.length
    } catch (err) {
      if (controller.signal.aborted) return
      throw this.wrapNetworkError(err)
    } finally {
      reader.releaseLock()
    }
  }

  private outputFormat(config: TTSConfig): string {
    const requested = config.sampleRate ?? DEFAULT_SAMPLE_RATE
    const rate = SUPPORTED_PCM_RATES.includes(requested as (typeof SUPPORTED_PCM_RATES)[number])
      ? requested
      : DEFAULT_SAMPLE_RATE
    return `pcm_${rate}`
  }

  private wrapHttpError(status: number, body: string): Error {
    const excerpt = body.slice(0, 500)
    logError(`[elevenlabs] synthesis failed: HTTP ${status} ${excerpt}`)
    const userMessage =
      status === 401
        ? 'ElevenLabs rejected the API key. Check ELEVENLABS_API_KEY.'
        : status === 422
          ? 'ElevenLabs rejected the request. Check the configured voice ID and model.'
          : status === 429
            ? 'ElevenLabs rate limit or quota reached. Speech output is paused; text still works.'
            : `ElevenLabs synthesis failed (HTTP ${status}). Text output still works.`
    return Object.assign(new Error(`ElevenLabs synthesis failed: ${status}`), {
      httpStatus: status,
      bodyExcerpt: excerpt || null,
      userMessage,
    })
  }

  private wrapNetworkError(err: unknown): Error {
    const message = err instanceof Error ? err.message : String(err)
    logError(`[elevenlabs] network error: ${message}`)
    return Object.assign(new Error(`ElevenLabs request failed: ${message}`), {
      userMessage: 'Could not reach ElevenLabs. Speech output is unavailable; text still works.',
    })
  }
}

const ELEVENLABS_STREAM_URL = 'https://api.elevenlabs.io/v1/text-to-speech'
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'
const DEFAULT_MODEL = 'eleven_turbo_v2_5'
const DEFAULT_SAMPLE_RATE = 24000
const SUPPORTED_PCM_RATES = [16000, 22050, 24000, 44100] as const

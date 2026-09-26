import type { AudioChunk, SynthesizeOptions, TTSConfig, TTSProvider } from './interface.js'
import {
  evaluateGptSovitsBaseline,
  type GptSovitsInstallationProbe,
} from '../voice/gpt-sovits-baseline.js'
import { createGptSovitsSynthesisTransport } from '../voice/gpt-sovits-transports.js'
import { resamplePcm16 } from '../voice/pcm.js'
import { checkGptSovitsSynthesis } from '../voice/gpt-sovits-readiness.js'

export interface GptSovitsSynthesisRequest {
  text: string
  textLang: string
  referenceAudioPath: string
  promptText: string
  promptLang: string
  mediaType: 'wav'
  speedFactor?: number
}

export interface GptSovitsTtsDependencies {
  requestSynthesis(request: GptSovitsSynthesisRequest, signal?: AbortSignal): Promise<Uint8Array>
  probeInstallation?: GptSovitsInstallationProbe
}

export interface GptSovitsTtsSettings {
  serviceUrl: string
  referenceAudioPath: string
  promptText: string
  promptLang: string
  textLang: string
  speedFactor?: number
  sampleRate: number
}

const DEFAULT_SAMPLE_RATE = 32000
const CHUNK_BYTES = 8192

export class GptSovitsTTSProvider implements TTSProvider {
  readonly id = 'gpt-sovits-tts'
  #settings: GptSovitsTtsSettings | null = null
  #requestSynthesis: GptSovitsTtsDependencies['requestSynthesis'] | null = null
  #submittedCharacters = 0
  readonly #requests = new Set<AbortController>()
  #generation = 0

  constructor(private readonly dependencies: Partial<GptSovitsTtsDependencies> = {}) {}

  async connect(config: TTSConfig): Promise<void> {
    this.#settings = null
    const settings = readGptSovitsTtsSettings(config)
    const probe = this.dependencies.probeInstallation
    if (!probe && !this.dependencies.requestSynthesis) {
      await checkGptSovitsSynthesis(settings.serviceUrl)
    }
    if (probe) {
      const baseline = await evaluateGptSovitsBaseline(probe)
      if (!baseline.synthesis.ready) {
        throw failure(
          baseline.synthesis.warning?.message ?? 'GPT-SoVITS synthesis baseline mismatch'
        )
      }
    }
    this.#settings = settings
    this.#requestSynthesis =
      this.dependencies.requestSynthesis ??
      createGptSovitsSynthesisTransport({ serviceUrl: settings.serviceUrl }).requestSynthesis
  }

  async *synthesize(text: string, _options?: SynthesizeOptions): AsyncIterable<AudioChunk> {
    const settings = this.#settings
    if (!settings) throw failure('GPT-SoVITS synthesis was requested before connect')
    if (!this.#requestSynthesis) {
      throw failure('GPT-SoVITS synthesis transport is not configured')
    }
    this.#submittedCharacters += text.length
    const cancellation = new AbortController()
    const generation = this.#generation
    this.#requests.add(cancellation)
    let bytes: Uint8Array
    try {
      bytes = await this.#requestSynthesis(
        {
          text,
          textLang: settings.textLang,
          referenceAudioPath: settings.referenceAudioPath,
          promptText: settings.promptText,
          promptLang: settings.promptLang,
          mediaType: 'wav',
          ...(settings.speedFactor === undefined ? {} : { speedFactor: settings.speedFactor }),
        },
        cancellation.signal
      )
    } catch (error) {
      if (cancellation.signal.aborted) return
      throw failure(
        `GPT-SoVITS synthesis failed: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      this.#requests.delete(cancellation)
    }
    if (cancellation.signal.aborted) return
    const decoded = decodeWav(bytes)
    const pcm =
      decoded.sampleRate === settings.sampleRate
        ? decoded.pcm
        : resamplePcm16(decoded.pcm, decoded.sampleRate, settings.sampleRate)
    for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
      if (cancellation.signal.aborted || generation !== this.#generation || !this.#settings) return
      yield { data: pcm.subarray(offset, offset + CHUNK_BYTES).toString('base64') }
    }
  }

  getPlaybackPosition(): number {
    return this.#submittedCharacters
  }

  async stop(): Promise<void> {
    this.#generation += 1
    for (const request of this.#requests) request.abort()
  }

  async disconnect(): Promise<void> {
    await this.stop()
    this.#settings = null
  }
}

export function readGptSovitsTtsSettings(config: TTSConfig): GptSovitsTtsSettings {
  const extended = config as TTSConfig & Partial<GptSovitsTtsSettings>
  const serviceUrl = extended.serviceUrl ?? process.env.GPT_SOVITS_SERVICE_URL
  const referenceAudioPath = extended.referenceAudioPath ?? process.env.GPT_SOVITS_REFERENCE_AUDIO
  const textLang = extended.textLang ?? process.env.GPT_SOVITS_TEXT_LANG
  if (!serviceUrl || !referenceAudioPath || !textLang) {
    throw failure('GPT-SoVITS synthesis needs a service URL, reference audio, and target language')
  }
  return {
    serviceUrl,
    referenceAudioPath,
    promptText: extended.promptText ?? process.env.GPT_SOVITS_PROMPT_TEXT ?? '',
    promptLang: extended.promptLang ?? process.env.GPT_SOVITS_PROMPT_LANG ?? textLang,
    textLang,
    ...(extended.speedFactor === undefined ? {} : { speedFactor: extended.speedFactor }),
    sampleRate: extended.sampleRate ?? DEFAULT_SAMPLE_RATE,
  }
}

function decodeWav(bytes: Uint8Array): { sampleRate: number; pcm: Buffer } {
  const buffer = Buffer.from(bytes)
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
    throw failure('GPT-SoVITS returned audio that is not a WAV file')
  }
  let offset = 12
  let sampleRate = 0
  let channels = 0
  let bitsPerSample = 0
  let payload: Buffer | undefined
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const body = offset + 8
    if (chunkId === 'fmt ' && body + 16 <= buffer.length) {
      channels = buffer.readUInt16LE(body + 2)
      sampleRate = buffer.readUInt32LE(body + 4)
      bitsPerSample = buffer.readUInt16LE(body + 14)
    }
    if (chunkId === 'data') payload = buffer.subarray(body, body + chunkSize)
    offset = body + chunkSize + (chunkSize % 2)
  }
  if (!payload || sampleRate <= 0 || channels !== 1 || bitsPerSample !== 16) {
    throw failure('GPT-SoVITS returned WAV audio this provider cannot decode')
  }
  return { sampleRate, pcm: payload }
}

function failure(message: string): Error {
  return Object.assign(new Error(message), { userMessage: message })
}

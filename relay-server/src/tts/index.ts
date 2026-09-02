import { ElevenLabsTTSProvider } from './elevenlabs.js'
import type { TTSProvider } from './interface.js'

export type { AudioChunk, SynthesizeOptions, TTSConfig, TTSProvider } from './interface.js'
export { ElevenLabsTTSProvider } from './elevenlabs.js'

export const DEFAULT_TTS_PROVIDER = 'elevenlabs'
export const SUPPORTED_TTS_PROVIDERS = ['elevenlabs'] as const

// Cap on sentences batched into one synthesis request. Larger batches give the
// model cross-sentence prosody context but delay first audio unacceptably.
export const MAX_SENTENCE_BATCH_SIZE = 5
export const DEFAULT_SENTENCE_BATCH_SIZE = 1

export function clampSentenceBatchSize(requested?: number): number {
  if (!requested || !Number.isFinite(requested)) return DEFAULT_SENTENCE_BATCH_SIZE
  return Math.min(MAX_SENTENCE_BATCH_SIZE, Math.max(1, Math.floor(requested)))
}

export function createTTSProvider(name?: string): TTSProvider {
  const provider = (name ?? DEFAULT_TTS_PROVIDER).toLowerCase()
  switch (provider) {
    case 'elevenlabs':
      return new ElevenLabsTTSProvider()
    default:
      throw Object.assign(
        new Error(
          `Unknown TTS provider: ${provider}. Supported: ${SUPPORTED_TTS_PROVIDERS.join(', ')}.`
        ),
        {
          userMessage: `Unknown TTS provider "${provider}". Supported: ${SUPPORTED_TTS_PROVIDERS.join(', ')}.`,
        }
      )
  }
}

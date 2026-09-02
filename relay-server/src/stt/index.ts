import { DeepgramSTTProvider } from './deepgram.js'
import type { STTProvider } from './interface.js'

export type { STTConfig, STTProvider, TranscriptCallback } from './interface.js'
export { DeepgramSTTProvider } from './deepgram.js'

export const DEFAULT_STT_PROVIDER = 'deepgram'
export const SUPPORTED_STT_PROVIDERS = ['deepgram'] as const

export function createSTTProvider(name?: string): STTProvider {
  const provider = (name ?? DEFAULT_STT_PROVIDER).toLowerCase()
  switch (provider) {
    case 'deepgram':
      return new DeepgramSTTProvider()
    default:
      throw Object.assign(
        new Error(
          `Unknown STT provider: ${provider}. Supported: ${SUPPORTED_STT_PROVIDERS.join(', ')}.`
        ),
        {
          userMessage: `Unknown STT provider "${provider}". Supported: ${SUPPORTED_STT_PROVIDERS.join(', ')}.`,
        }
      )
  }
}

import { DeepgramSTTProvider } from './deepgram.js'
import { GptSovitsSTTProvider, type GptSovitsSttDependencies } from './gpt-sovits.js'
import type { STTProvider } from './interface.js'

export type { STTConfig, STTProvider, TranscriptCallback } from './interface.js'
export { DeepgramSTTProvider } from './deepgram.js'
export { GptSovitsSTTProvider } from './gpt-sovits.js'
export type { GptSovitsAsrInvocation, GptSovitsSttDependencies } from './gpt-sovits.js'

export const DEFAULT_STT_PROVIDER = 'deepgram'
export const SUPPORTED_STT_PROVIDERS = ['deepgram', 'gpt-sovits-stt'] as const

export function createSTTProvider(
  name?: string,
  dependencies: Partial<GptSovitsSttDependencies> = {}
): STTProvider {
  const provider = (name ?? DEFAULT_STT_PROVIDER).toLowerCase()
  switch (provider) {
    case 'deepgram':
      return new DeepgramSTTProvider()
    case 'gpt-sovits-stt':
      return new GptSovitsSTTProvider(dependencies)
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

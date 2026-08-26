import type { HarnessAdapter } from '../harness-adapter/interface.js'
import { createHarnessAdapter, listHarnessAdapters } from '../harness-adapter/registry.js'
import { HarnessHTTPClient } from '../harness-adapter/http-client.js'
import type { STTProvider } from '../stt/interface.js'
import { createSTTProvider, SUPPORTED_STT_PROVIDERS } from '../stt/index.js'
import type { TTSProvider } from '../tts/interface.js'
import { createTTSProvider, SUPPORTED_TTS_PROVIDERS } from '../tts/index.js'
import type { SessionConfigEvent } from '../types.js'
import { ComposedAdapter } from './composed/index.js'
import { OutputRouter } from './composed/output-router.js'
import type { ThinkingContent } from '../harness-adapter/types.js'
import {
  getThinkingStorage,
  type ThinkingEntry,
  type ThinkingSaveMetadata,
} from '../thinking/storage.js'
import type { ProviderAdapter, SendToClient } from './types.js'
import { EchoAdapter } from './echo.js'
import { OpenAIAdapter } from './openai.js'
import { GeminiAdapter } from './gemini.js'
import { XAIAdapter } from './xai.js'

export interface AdapterFactoryDependencies {
  createSTTProvider?: (name?: string) => STTProvider
  createHarnessAdapter?: (id: string) => HarnessAdapter
  createTTSProvider?: (name?: string) => TTSProvider
  sendToClient?: SendToClient
  saveThinking?: (entry: ThinkingEntry) => Promise<ThinkingSaveMetadata | null>
  attachThinking?: (content: ThinkingContent, turnId?: string) => void
  getThinkingTracePath?: (turnId?: string) => string | undefined
}

export function createAdapter(
  input: string | SessionConfigEvent,
  dependencies: AdapterFactoryDependencies = {}
): ProviderAdapter {
  if (typeof input !== 'string' && input.mode === 'stt-tts') {
    const sttProvider = requireComponentId(input.sttProvider, 'sttProvider')
    const harnessId = requireComponentId(input.harness, 'harness')
    const ttsProvider = requireComponentId(input.ttsProvider, 'ttsProvider')
    validateComponents(sttProvider, harnessId, ttsProvider)
    const stt = (dependencies.createSTTProvider ?? createSTTProvider)(sttProvider)
    const harness = (dependencies.createHarnessAdapter ?? defaultHarnessFactory)(harnessId)
    const tts = (dependencies.createTTSProvider ?? createTTSProvider)(ttsProvider)
    const thinkingStorage = getThinkingStorage()
    const outputRouter = new OutputRouter({
      tts,
      sendToClient: dependencies.sendToClient ?? (() => {}),
      sentenceBatchSize: input.ttsConfig?.sentenceBatchSize,
      saveThinking:
        dependencies.saveThinking ??
        ((entry) =>
          thinkingStorage.append(entry, dependencies.getThinkingTracePath?.(entry.turnId))),
      attachThinkingContent: dependencies.attachThinking,
    })
    return new ComposedAdapter(stt, harness, tts, outputRouter)
  }
  const provider = typeof input === 'string' ? input : input.provider
  switch (provider) {
    case 'echo':
      return new EchoAdapter()
    case 'openai':
      return new OpenAIAdapter()
    case 'gemini':
      return new GeminiAdapter()
    case 'xai':
      return new XAIAdapter()
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

function defaultHarnessFactory(id: string): HarnessAdapter {
  return createHarnessAdapter(id, new HarnessHTTPClient())
}

function requireComponentId(value: string | undefined, field: string): string {
  if (value?.trim()) return value
  throw new Error(`${field} is required when mode is stt-tts`)
}

function validateComponents(sttProvider: string, harnessId: string, ttsProvider: string): void {
  if (!SUPPORTED_STT_PROVIDERS.includes(sttProvider.toLowerCase() as 'deepgram')) {
    throw new Error(
      `Unknown STT provider ${sttProvider}. Supported: ${SUPPORTED_STT_PROVIDERS.join(', ')}`
    )
  }
  if (!SUPPORTED_TTS_PROVIDERS.includes(ttsProvider.toLowerCase() as 'elevenlabs')) {
    throw new Error(
      `Unknown TTS provider ${ttsProvider}. Supported: ${SUPPORTED_TTS_PROVIDERS.join(', ')}`
    )
  }
  const harnesses = listHarnessAdapters()
  const harness = harnesses.find((entry) => entry.id === harnessId)
  const known = harnesses.map((entry) => entry.id).join(', ')
  const available = harnesses
    .filter((entry) => entry.available)
    .map((entry) => entry.id)
    .join(', ')
  if (!harness) {
    throw new Error(`Unknown Harness adapter ${harnessId}. Known IDs: ${known}`)
  }
  if (!harness.available) {
    throw new Error(
      `Harness adapter ${harnessId} is not available. Available: ${available}. Known IDs: ${known}`
    )
  }
}

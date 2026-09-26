import { describe, expect, it } from 'vitest'
import { ComposedAdapter } from '../../src/adapters/composed/index.js'
import { createAdapter, type AdapterFactoryDependencies } from '../../src/adapters/index.js'
import type { HarnessAdapter } from '../../src/harness-adapter/interface.js'
import { createSTTProvider } from '../../src/stt/index.js'
import { createTTSProvider } from '../../src/tts/index.js'
import type { SessionConfigEvent } from '../../src/types.js'

function sessionConfig(overrides: Partial<SessionConfigEvent> = {}): SessionConfigEvent {
  return {
    type: 'session.config',
    mode: 'stt-tts',
    sttProvider: 'deepgram',
    ttsProvider: 'elevenlabs',
    harness: 'claude-code',
    ...overrides,
  } as SessionConfigEvent
}

function recordingDependencies(seen: string[]): AdapterFactoryDependencies {
  return {
    createSTTProvider: (name) => {
      seen.push(name ?? 'default')
      return createSTTProvider(name)
    },
    createTTSProvider: (name) => {
      seen.push(name ?? 'default')
      return createTTSProvider(name)
    },
    createHarnessAdapter: () =>
      ({
        connect: async () => undefined,
        disconnect: async () => undefined,
      }) as unknown as HarnessAdapter,
  }
}

describe('GPT-SoVITS session selection', () => {
  it('resolves both local ids through the composed path and pairs them independently', () => {
    const local: string[] = []
    expect(
      createAdapter(
        sessionConfig({ sttProvider: 'gpt-sovits-stt', ttsProvider: 'gpt-sovits-tts' }),
        recordingDependencies(local)
      )
    ).toBeInstanceOf(ComposedAdapter)
    expect(local).toEqual(['gpt-sovits-stt', 'gpt-sovits-tts'])

    const mixed: string[] = []
    expect(
      createAdapter(
        sessionConfig({ sttProvider: 'deepgram', ttsProvider: 'gpt-sovits-tts' }),
        recordingDependencies(mixed)
      )
    ).toBeInstanceOf(ComposedAdapter)
    expect(mixed).toEqual(['deepgram', 'gpt-sovits-tts'])
  })

  it('keeps the cloud selection and cross-boundary rejection unchanged', () => {
    const cloud: string[] = []
    createAdapter(
      sessionConfig({ sttProvider: 'deepgram', ttsProvider: 'elevenlabs' }),
      recordingDependencies(cloud)
    )
    expect(cloud).toEqual(['deepgram', 'elevenlabs'])

    const localIdOnCloudBoundary: string[] = []
    expect(() =>
      createAdapter(
        sessionConfig({ sttProvider: 'gpt-sovits-tts', ttsProvider: 'elevenlabs' }),
        recordingDependencies(localIdOnCloudBoundary)
      )
    ).toThrowError(/Supported: deepgram, gpt-sovits-stt/)
  })
})

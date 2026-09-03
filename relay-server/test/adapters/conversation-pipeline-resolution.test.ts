import { describe, expect, it } from 'vitest'
import { ComposedAdapter } from '../../src/adapters/composed/index.js'
import { createAdapter, type AdapterFactoryDependencies } from '../../src/adapters/index.js'
import { OpenAIAdapter } from '../../src/adapters/openai.js'
import type { HarnessAdapter } from '../../src/harness-adapter/interface.js'
import type { STTProvider } from '../../src/stt/interface.js'
import { effectiveVoiceMode } from '../../src/tools/index.js'
import type { TTSProvider } from '../../src/tts/interface.js'
import {
  resolveSessionMode,
  type SessionConfigEvent,
  type SessionMode,
  type VoiceMode,
} from '../../src/types.js'

describe('Conversation Pipeline resolution', () => {
  it.each([
    ['stt-tts', 'stt-tts'],
    ['s2s', 's2s'],
    [undefined, 's2s'],
    ['unknown', 's2s'],
  ] as const)('normalizes session mode %s to %s', (input, expected) => {
    expect(resolveSessionMode(input)).toBe(expected)
  })

  it.each([
    [undefined, 'direct'],
    ['unknown', 'direct'],
    ['direct', 'direct'],
    ['operator', 'operator'],
    ['supervisor', 'direct'],
  ] as const)('resolves voice mode %s to S2S %s behavior', (voiceMode, expected) => {
    expect(effectiveVoiceMode(config({ voiceMode: voiceMode as VoiceMode | undefined }))).toBe(
      expected
    )
  })

  it.each([undefined, 'direct', 'operator', 'supervisor', 'unknown'] as const)(
    'selects STT/TTS Harness independently of voice mode %s',
    (voiceMode) => {
      const constructed: string[] = []
      const adapter = createAdapter(
        config({ mode: 'stt-tts', voiceMode: voiceMode as VoiceMode | undefined }),
        componentDependencies(constructed)
      )

      expect(adapter).toBeInstanceOf(ComposedAdapter)
      expect(constructed).toEqual(['stt', 'harness', 'tts'])
    }
  )

  it.each([
    [undefined, undefined],
    ['s2s', 'direct'],
    ['s2s', 'operator'],
    ['s2s', 'supervisor'],
    ['unknown', 'operator'],
  ] as const)('keeps mode %s with voice mode %s on the S2S adapter path', (mode, voiceMode) => {
    const constructed: string[] = []
    const adapter = createAdapter(
      config({
        mode: mode as SessionMode | undefined,
        voiceMode: voiceMode as VoiceMode | undefined,
      }),
      componentDependencies(constructed)
    )

    expect(adapter).toBeInstanceOf(OpenAIAdapter)
    expect(constructed).toEqual([])
  })
})

function config(overrides: Partial<SessionConfigEvent> = {}): SessionConfigEvent {
  return {
    type: 'session.config',
    provider: 'openai',
    voice: 'test',
    brainAgent: 'none',
    apiKey: 'test',
    sttProvider: 'deepgram',
    ttsProvider: 'elevenlabs',
    harness: 'claude-code',
    ...overrides,
  }
}

function componentDependencies(constructed: string[]): AdapterFactoryDependencies {
  return {
    createSTTProvider: () => {
      constructed.push('stt')
      return sttProvider()
    },
    createHarnessAdapter: () => {
      constructed.push('harness')
      return harnessAdapter()
    },
    createTTSProvider: () => {
      constructed.push('tts')
      return ttsProvider()
    },
  }
}

function sttProvider(): STTProvider {
  return {
    async connect() {},
    processAudio() {},
    commit() {},
    onPartialTranscript() {},
    onFinalTranscript() {},
    onError() {},
    async disconnect() {},
  }
}

function harnessAdapter(): HarnessAdapter {
  return {
    id: 'fake',
    capabilities: {
      structuredOutput: true,
      interruption: false,
      overlay: false,
      streaming: true,
    },
    async connect() {},
    async sendMessage() {
      return { cancel: () => {}, done: Promise.resolve() }
    },
    async disconnect() {},
  }
}

function ttsProvider(): TTSProvider {
  return {
    async connect() {},
    async *synthesize() {},
    getPlaybackPosition: () => 0,
    async stop() {},
    async disconnect() {},
  }
}

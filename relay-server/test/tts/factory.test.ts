import { describe, expect, it } from 'vitest'
import {
  ElevenLabsTTSProvider,
  clampSentenceBatchSize,
  createTTSProvider,
} from '../../src/tts/index.js'

describe('clampSentenceBatchSize', () => {
  it.each([
    [undefined, 1],
    [0, 1],
    [-4, 1],
    [2.8, 2],
    [5, 5],
    [9, 5],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
    ['3' as unknown as number, 1],
  ])('maps %s to %s', (requested, expected) => {
    expect(clampSentenceBatchSize(requested)).toBe(expected)
  })
})

describe('createTTSProvider', () => {
  it('creates ElevenLabs by default and accepts a case-insensitive provider name', () => {
    expect(createTTSProvider()).toBeInstanceOf(ElevenLabsTTSProvider)
    expect(createTTSProvider('ELEVENLABS')).toBeInstanceOf(ElevenLabsTTSProvider)
  })

  it('rejects an empty or unknown provider with the supported provider list', () => {
    for (const name of ['', 'openai']) {
      expect(() => createTTSProvider(name)).toThrowError(/Supported: elevenlabs/)
    }
  })
})

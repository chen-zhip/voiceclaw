import { describe, expect, it } from 'vitest'
import {
  ElevenLabsTTSProvider,
  createTTSProvider,
  SUPPORTED_TTS_PROVIDERS,
} from '../../src/tts/index.js'
import {
  DeepgramSTTProvider,
  createSTTProvider,
  SUPPORTED_STT_PROVIDERS,
} from '../../src/stt/index.js'

describe('GPT-SoVITS provider registration', () => {
  it('registers a separate local provider for each voice boundary', () => {
    const tts = createTTSProvider('gpt-sovits-tts')
    const stt = createSTTProvider('gpt-sovits-stt')

    expect(tts.id).toBe('gpt-sovits-tts')
    expect(stt.id).toBe('gpt-sovits-stt')
    expect(tts.id).not.toBe(stt.id)
    expect(SUPPORTED_TTS_PROVIDERS).toContain('gpt-sovits-tts')
    expect(SUPPORTED_STT_PROVIDERS).toContain('gpt-sovits-stt')
    expect(SUPPORTED_TTS_PROVIDERS).not.toContain('gpt-sovits-stt')
    expect(SUPPORTED_STT_PROVIDERS).not.toContain('gpt-sovits-tts')
  })

  it('answers only its own voice boundary', () => {
    const tts = createTTSProvider('gpt-sovits-tts')
    const stt = createSTTProvider('gpt-sovits-stt')

    expect('synthesize' in tts).toBe(true)
    expect('processAudio' in tts).toBe(false)
    expect('processAudio' in stt).toBe(true)
    expect('synthesize' in stt).toBe(false)
  })

  it('rejects each local id on the other voice boundary', () => {
    expect(() => createTTSProvider('gpt-sovits-stt')).toThrowError(
      /Supported: elevenlabs, gpt-sovits-tts/
    )
    expect(() => createSTTProvider('gpt-sovits-tts')).toThrowError(
      /Supported: deepgram, gpt-sovits-stt/
    )
  })

  it('keeps existing providers, case-insensitive selection, and unknown-id rejection', () => {
    expect(createTTSProvider()).toBeInstanceOf(ElevenLabsTTSProvider)
    expect(createSTTProvider()).toBeInstanceOf(DeepgramSTTProvider)
    expect(createTTSProvider('GPT-SOVITS-TTS').id).toBe('gpt-sovits-tts')
    expect(createSTTProvider('GPT-SOVITS-STT').id).toBe('gpt-sovits-stt')
    expect(() => createTTSProvider('gpt-sovits')).toThrowError(/Supported: elevenlabs/)
    expect(() => createSTTProvider('gpt-sovits')).toThrowError(/Supported: deepgram/)
  })
})

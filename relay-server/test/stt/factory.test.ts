import { describe, expect, it } from 'vitest'
import { DeepgramSTTProvider, createSTTProvider } from '../../src/stt/index.js'

describe('createSTTProvider', () => {
  it('creates Deepgram by default and accepts a case-insensitive provider name', () => {
    expect(createSTTProvider()).toBeInstanceOf(DeepgramSTTProvider)
    expect(createSTTProvider('DEEPGRAM')).toBeInstanceOf(DeepgramSTTProvider)
  })

  it('rejects an empty or unknown provider with the supported provider list', () => {
    for (const name of ['', 'whisper']) {
      expect(() => createSTTProvider(name)).toThrowError(/Supported: deepgram/)
    }
  })
})

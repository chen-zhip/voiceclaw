import { describe, expect, it, vi } from 'vitest'

describe('STT/TTS Harness audio bridge', () => {
  it('bridges microphone commits, public output, playback, cancellation, and recovery', async () => {
    const audioModule = await import('./stt-tts-harness-audio.js').catch(() => ({}))
    const STTTTSHarnessAudioBridge = Reflect.get(audioModule, 'STTTTSHarnessAudioBridge')

    expect(STTTTSHarnessAudioBridge).toBeTypeOf('function')

    const transport = {
      send: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
    }
    const bridge = new STTTTSHarnessAudioBridge(transport)

    bridge.appendMicrophone('pcm-1')
    bridge.appendMicrophone('pcm-2')
    expect(transport.send).toHaveBeenNthCalledWith(1, { type: 'audio.append', data: 'pcm-1' })
    expect(transport.send).toHaveBeenNthCalledWith(2, { type: 'audio.append', data: 'pcm-2' })

    bridge.commitMicrophone()
    expect(transport.send).toHaveBeenCalledWith({ type: 'audio.commit' })

    bridge.receive({
      type: 'harness.semantic-output',
      classification: 'public-screen',
      text: 'Answer',
    })
    bridge.receive({ type: 'audio.delta', data: 'audio-1' })
    bridge.receive({
      type: 'harness.terminal',
      classification: 'terminal',
      outcome: { outcome: 'completed' },
    })
    expect(bridge.snapshot()).toEqual({
      screenText: ['Answer'],
      audio: ['audio-1'],
      playback: 'playing',
      terminal: { outcome: 'completed' },
      recovery: [],
    })

    await bridge.cancel('user_request')
    expect(transport.cancel).toHaveBeenCalledWith('user_request')

    bridge.receive({
      type: 'harness.error',
      reason: 'binding-unavailable',
      recovery: ['retry', 'reselect-provider', 'return-to-s2s'],
    })
    expect(bridge.snapshot().recovery).toEqual(['retry', 'reselect-provider', 'return-to-s2s'])
  })
})

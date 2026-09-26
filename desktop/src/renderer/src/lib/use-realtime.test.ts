import { describe, expect, it } from 'vitest'
import { buildRealtimeSessionConfig, shouldCaptureMicrophone } from './use-realtime.js'

describe('realtime input mode', () => {
  it('does not capture microphone input for typed Harness turns', () => {
    expect(shouldCaptureMicrophone({ inputMode: 'text' })).toBe(false)
  })

  it('keeps microphone capture as the default for voice sessions', () => {
    expect(shouldCaptureMicrophone({})).toBe(true)
  })

  it('forwards the stable VoiceClaw conversation key to Relay', () => {
    const config = buildRealtimeSessionConfig({
      serverUrl: 'ws://relay.test/ws',
      voice: 'alloy',
      model: 'gpt-realtime-mini',
      brainAgent: 'enabled',
      apiKey: 'test-key',
      sessionKey: 'voiceclaw-desktop:conversation-42',
    })

    expect(config.sessionKey).toBe('voiceclaw-desktop:conversation-42')
  })
})

import { describe, expect, it } from 'vitest'

const complete = {
  harness_provider_id: 'codex',
  harness_workspace_binding_id: 'workspace-1',
  harness_binding_id: 'binding-1',
  harness_stt_provider: 'gpt-sovits-stt',
  harness_tts_provider: 'gpt-sovits-tts',
  harness_id: 'codex',
}

describe('STT/TTS Harness session configuration', () => {
  it('assembles the session config from six configured values', async () => {
    const { resolveHarnessSessionConfig } = await import('./stt-tts-harness-config.js')

    const result = resolveHarnessSessionConfig(complete)

    expect(result).toEqual({
      config: {
        mode: 'stt-tts',
        inputMode: 'microphone',
        sttProvider: 'gpt-sovits-stt',
        ttsProvider: 'gpt-sovits-tts',
        harness: 'codex',
        harnessBinding: {
          bindingId: 'binding-1',
          providerId: 'codex',
          workspaceBindingId: 'workspace-1',
        },
      },
    })
    expect(JSON.stringify(result)).not.toContain('voiceMode')
  })

  it('names the exact missing field for every value', async () => {
    const { resolveHarnessSessionConfig } = await import('./stt-tts-harness-config.js')
    const messages = new Set<string>()

    for (const key of Object.keys(complete)) {
      const result = resolveHarnessSessionConfig({ ...complete, [key]: undefined })
      expect(result).toHaveProperty('unavailable')
      const message = (result as { unavailable: string }).unavailable
      expect(message.length).toBeGreaterThan(10)
      expect(message).toMatch(/Settings|Workspace|Harness|provider/i)
      messages.add(message)
    }

    expect(messages.size).toBe(6)
  })

  it('reads the six settings through the shared key map', async () => {
    const { HARNESS_SETTING_KEYS, readHarnessSessionConfig, resolveHarnessSessionConfig } =
      await import('./stt-tts-harness-config.js')

    expect(Object.keys(HARNESS_SETTING_KEYS)).toEqual([
      'providerId',
      'workspaceBindingId',
      'bindingId',
      'sttProvider',
      'ttsProvider',
      'harnessId',
    ])

    const read = async (key: string) => complete[key as keyof typeof complete]
    await expect(readHarnessSessionConfig(read)).resolves.toEqual(
      resolveHarnessSessionConfig(complete)
    )
    await expect(
      readHarnessSessionConfig(async (key) =>
        key === 'harness_id' ? undefined : (read(key) as never)
      )
    ).resolves.toMatchObject({ unavailable: expect.stringContaining('Harness') })
  })
})

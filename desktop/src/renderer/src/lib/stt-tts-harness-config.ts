export const HARNESS_SETTING_KEYS = {
  providerId: 'harness_provider_id',
  workspaceBindingId: 'harness_workspace_binding_id',
  bindingId: 'harness_binding_id',
  sttProvider: 'harness_stt_provider',
  ttsProvider: 'harness_tts_provider',
  harnessId: 'harness_id',
} as const

export type HarnessSettingKey = (typeof HARNESS_SETTING_KEYS)[keyof typeof HARNESS_SETTING_KEYS]

export interface HarnessSessionSettings {
  harness_provider_id?: string
  harness_workspace_binding_id?: string
  harness_binding_id?: string
  harness_stt_provider?: string
  harness_tts_provider?: string
  harness_id?: string
}

export interface HarnessSessionConfig {
  mode: 'stt-tts'
  inputMode: 'microphone'
  sttProvider: string
  ttsProvider: string
  harness: string
  harnessBinding: {
    bindingId: string
    providerId: string
    workspaceBindingId: string
  }
}

export function voiceclawSessionKey(conversationId: number): string {
  return `voiceclaw-desktop:${conversationId}`
}

export type HarnessSessionConfigResult = { config: HarnessSessionConfig } | { unavailable: string }

const MISSING_MESSAGES: Record<keyof HarnessSessionSettings, string> = {
  harness_provider_id: 'Select a Harness Provider for the STT/TTS Harness call in Settings.',
  harness_workspace_binding_id:
    'Select the Workspace to bind the STT/TTS Harness call to in Settings.',
  harness_binding_id:
    'Select the Harness Provider binding for the STT/TTS Harness call in Settings.',
  harness_stt_provider: 'Set the STT provider for the STT/TTS Harness call in Settings.',
  harness_tts_provider: 'Set the TTS provider for the STT/TTS Harness call in Settings.',
  harness_id: 'Set the Harness id for the STT/TTS Harness call in Settings.',
}

export function resolveHarnessSessionConfig(
  settings: HarnessSessionSettings
): HarnessSessionConfigResult {
  for (const key of Object.keys(HARNESS_SETTING_KEYS) as Array<keyof typeof HARNESS_SETTING_KEYS>) {
    const settingKey = HARNESS_SETTING_KEYS[key]
    if (!settings[settingKey]?.trim()) return { unavailable: MISSING_MESSAGES[settingKey] }
  }
  const providerId = (settings.harness_provider_id as string).trim()
  const workspaceBindingId = (settings.harness_workspace_binding_id as string).trim()
  const bindingId = (settings.harness_binding_id as string).trim()
  return {
    config: {
      mode: 'stt-tts',
      // A real STT/TTS Harness session must stream microphone PCM to the
      // declared STT provider. Text input remains available through the
      // composer, but it must not disable microphone capture for voice turns.
      inputMode: 'microphone',
      sttProvider: (settings.harness_stt_provider as string).trim(),
      ttsProvider: (settings.harness_tts_provider as string).trim(),
      harness: (settings.harness_id as string).trim(),
      harnessBinding: { bindingId, providerId, workspaceBindingId },
    },
  }
}

export async function readHarnessSessionConfig(
  read: (key: HarnessSettingKey) => Promise<string | undefined>
): Promise<HarnessSessionConfigResult> {
  const settings: HarnessSessionSettings = {}
  for (const settingKey of Object.values(HARNESS_SETTING_KEYS)) {
    settings[settingKey] = await read(settingKey)
  }
  return resolveHarnessSessionConfig(settings)
}

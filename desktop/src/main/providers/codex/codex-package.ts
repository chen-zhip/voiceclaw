import manifest from './voiceclaw.plugin.json'
import { parsePluginManifest, type PluginManifestV0 } from '@voiceclaw/contracts'

export const CODEX_PACKAGE_ID = 'voiceclaw-provider-codex'
export const CODEX_PROVIDER_CONTRIBUTION_ID = 'codex-provider'
export const CODEX_SETTINGS_CONTRIBUTION_ID = 'codex-settings'

function requireManifest(input: unknown): PluginManifestV0 {
  const parsed = parsePluginManifest(input)
  if (!parsed.success) {
    throw new Error(
      `Codex plugin package manifest is invalid: ${parsed.errors
        .map((error) => `${error.path} ${error.code}`)
        .join(', ')}`
    )
  }
  return parsed.data
}

export const codexPluginManifest: PluginManifestV0 = requireManifest(manifest)

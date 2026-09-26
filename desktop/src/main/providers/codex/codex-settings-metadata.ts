import { codexPluginManifest, CODEX_PROVIDER_CONTRIBUTION_ID } from './codex-package.js'

export type ProviderSettingsFieldKind = 'text' | 'path' | 'enum' | 'secret-reference'

export interface ProviderSettingsFieldMetadata {
  key: string
  label: string
  kind: ProviderSettingsFieldKind
  required: boolean
  options?: string[]
}

export interface ProviderSettingsMetadata {
  providerId: string
  displayName: string
  profileVersion: string
  capabilityProfileVersion: string
  fields: ProviderSettingsFieldMetadata[]
}

const FIELD_LABELS: Record<string, string> = {
  executablePath: 'Codex executable path',
  workspacePath: 'Workspace path',
  model: 'Model',
  approvalPolicy: 'Approval policy',
  accountRef: 'Account reference',
}

const SECRET_REFERENCE_FIELDS = new Set(['accountRef'])
const PATH_FIELDS = new Set(['executablePath', 'workspacePath'])

function describeProviderSettings(): ProviderSettingsMetadata {
  const provider = codexPluginManifest.contributions.find(
    (contribution) => contribution.id === CODEX_PROVIDER_CONTRIBUTION_ID
  )
  const schema = (provider?.configSchema ?? {}) as {
    required?: string[]
    properties?: Record<string, { type?: string; enum?: string[] }>
  }
  const required = new Set(schema.required ?? [])
  return {
    providerId: codexPluginManifest.feature.id,
    displayName: codexPluginManifest.feature.displayName,
    profileVersion:
      provider?.provides.find((contract) => contract.id === 'harness.capability-profile')
        ?.version ?? '1.0.0',
    capabilityProfileVersion:
      provider?.provides.find((contract) => contract.id === 'harness.execution')?.version ??
      '1.0.0',
    fields: Object.entries(schema.properties ?? {}).map(([key, rule]) => ({
      key,
      label: FIELD_LABELS[key] ?? key,
      kind: SECRET_REFERENCE_FIELDS.has(key)
        ? 'secret-reference'
        : PATH_FIELDS.has(key)
          ? 'path'
          : rule.enum
            ? 'enum'
            : 'text',
      required: required.has(key),
      ...(rule.enum ? { options: [...rule.enum] } : {}),
    })),
  }
}

export const codexProviderSettingsMetadata: ProviderSettingsMetadata = describeProviderSettings()

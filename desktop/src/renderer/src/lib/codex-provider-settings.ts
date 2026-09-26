import type { CodexAvailabilityProjection } from '../../../main/providers/codex/codex-availability.js'
import type {
  ProviderSettingsFieldKind,
  ProviderSettingsMetadata,
} from '../../../main/providers/codex/codex-settings-metadata.js'

export interface ProviderSettingsField {
  key: string
  label: string
  kind: ProviderSettingsFieldKind
  required: boolean
  options?: string[]
  value: string
}

export interface ProviderSettingsView {
  providerId: string
  displayName: string
  fields: ProviderSettingsField[]
  profile: {
    status: 'exact' | 'unverified'
    profileVersion: string
    capabilityProfileVersion: string
    warnings: CodexAvailabilityProjection['warnings']
  }
  readiness: CodexAvailabilityProjection['readiness']
  workspace: {
    selected: string | null
    options: Array<{ id: string; label: string }>
  }
  canSelect: boolean
}

export function describeCodexProviderSettings(input: {
  metadata: ProviderSettingsMetadata
  configuration: {
    values: Record<string, string | undefined>
    workspaceBindingId: string | null
  }
  availability: CodexAvailabilityProjection
  workspaces: Array<{ id: string; label: string }>
}): ProviderSettingsView {
  const { availability, metadata } = input
  return {
    providerId: metadata.providerId,
    displayName: metadata.displayName,
    fields: metadata.fields.map((field) => ({
      key: field.key,
      label: field.label,
      kind: field.kind,
      required: field.required,
      ...(field.options ? { options: [...field.options] } : {}),
      value: input.configuration.values[field.key] ?? '',
    })),
    profile: {
      status: availability.profileStatus,
      profileVersion: availability.warnings[0]?.profileVersion ?? metadata.profileVersion,
      capabilityProfileVersion: availability.capabilityProfileVersion,
      warnings: availability.warnings.map((warning) => ({ ...warning })),
    },
    readiness: { ...availability.readiness },
    workspace: {
      selected: input.configuration.workspaceBindingId,
      options: input.workspaces.map((workspace) => ({ ...workspace })),
    },
    canSelect:
      availability.readiness.contribution === 'ACTIVE' &&
      availability.readiness.executable === 'detected' &&
      availability.readiness.session === 'ready',
  }
}

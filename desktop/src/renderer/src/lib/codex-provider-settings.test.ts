import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const availability = {
  providerId: 'codex' as const,
  bindingId: 'binding-1',
  workspaceBindingId: 'workspace-1',
  capabilityProfileVersion: '1.0.0',
  profileStatus: 'unverified' as const,
  readiness: {
    contribution: 'ACTIVE' as const,
    executable: 'detected' as const,
    process: 'running' as const,
    transport: 'ready' as const,
    session: 'ready' as const,
  },
  warnings: [
    {
      code: 'unverified-codex-version' as const,
      detectedVersion: '0.153.9',
      profileVersion: '0.153.4',
      message: 'Codex 0.153.9 is not an exactly verified Capability Profile',
    },
  ],
}

const values = {
  executablePath: 'C:\\tools\\codex.exe',
  workspacePath: 'C:\\workspaces\\first',
  model: 'gpt-5-codex',
  approvalPolicy: 'never',
  accountRef: 'os-secret://codex/account',
}

const workspaces = [
  { id: 'workspace-1', label: 'first' },
  { id: 'workspace-2', label: 'second' },
]

describe('Codex provider settings', () => {
  it('projects editable non-secret settings, profile, readiness, and Workspace selection', async () => {
    const { describeCodexProviderSettings } = await import('./codex-provider-settings.js')
    const { codexProviderSettingsMetadata } =
      await import('../../../main/providers/codex/codex-settings-metadata.js')

    const view = describeCodexProviderSettings({
      metadata: codexProviderSettingsMetadata,
      configuration: { values, workspaceBindingId: 'workspace-1' },
      availability,
      workspaces,
    })

    expect(view.providerId).toBe('codex')
    expect(view.displayName).toBe('Codex')
    expect(view.fields).toEqual([
      {
        key: 'executablePath',
        label: 'Codex executable path',
        kind: 'path',
        required: false,
        value: 'C:\\tools\\codex.exe',
      },
      {
        key: 'workspacePath',
        label: 'Workspace path',
        kind: 'path',
        required: true,
        value: 'C:\\workspaces\\first',
      },
      {
        key: 'model',
        label: 'Model',
        kind: 'text',
        required: false,
        value: 'gpt-5-codex',
      },
      {
        key: 'approvalPolicy',
        label: 'Approval policy',
        kind: 'enum',
        required: false,
        options: ['ask', 'never'],
        value: 'never',
      },
      {
        key: 'accountRef',
        label: 'Account reference',
        kind: 'secret-reference',
        required: false,
        value: 'os-secret://codex/account',
      },
    ])
    expect(view.profile).toEqual({
      status: 'unverified',
      profileVersion: '0.153.4',
      capabilityProfileVersion: '1.0.0',
      warnings: [availability.warnings[0]],
    })
    expect(view.readiness).toEqual(availability.readiness)
    expect(view.workspace).toEqual({
      selected: 'workspace-1',
      options: workspaces,
    })
    expect(view.canSelect).toBe(true)
  })

  it('keeps selection unavailable while the Codex Session is not ready', async () => {
    const { describeCodexProviderSettings } = await import('./codex-provider-settings.js')
    const { codexProviderSettingsMetadata } =
      await import('../../../main/providers/codex/codex-settings-metadata.js')

    const view = describeCodexProviderSettings({
      metadata: codexProviderSettingsMetadata,
      configuration: { values, workspaceBindingId: null },
      availability: {
        ...availability,
        profileStatus: 'exact',
        readiness: { ...availability.readiness, session: 'unavailable' },
        warnings: [],
      },
      workspaces,
    })

    expect(view.canSelect).toBe(false)
    expect(view.workspace.selected).toBeNull()
    expect(view.profile.warnings).toEqual([])
    expect(view.profile.status).toBe('exact')
  })

  it('keeps Provider-specific branches out of generic routing inputs', async () => {
    const genericModules = [
      'src/renderer/src/lib/stt-tts-harness-selection.ts',
      'src/renderer/src/lib/stt-tts-harness-audio.ts',
    ]
    for (const module of genericModules) {
      const source = await readFile(resolve(process.cwd(), module), 'utf8')
      expect(source).not.toMatch(/\bcodex\b/i)
    }
  })
})

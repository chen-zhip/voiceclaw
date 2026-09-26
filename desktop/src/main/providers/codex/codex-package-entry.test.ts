import { describe, expect, it } from 'vitest'
import { codexPluginManifest } from './codex-package.js'

function envelope(operation: string) {
  return {
    contract: { id: 'harness.execution', version: '1.0.0' },
    operation,
    invocationId: 'invocation-entry',
    principal: { kind: 'contribution', id: 'routing' },
    scope: { kind: 'workspace', id: 'workspace-1' },
    selectedContribution: {
      packageId: 'voiceclaw-provider-codex',
      contributionId: 'codex-provider',
    },
    generation: 1,
    trace: { traceId: 'trace-entry' },
    cancellation: { supported: true, token: 'cancel-entry' },
  } as never
}

const configuration = {
  bindingId: 'binding-1',
  workspaceBindingId: 'workspace-1',
  workspacePath: 'C:\\workspaces\\private-project',
  executablePath: 'C:\\tools\\codex.exe',
  preferences: { model: 'gpt-5-codex', approvalPolicy: 'never' },
  secretRefs: { accountRef: 'os-secret://codex/account' },
}

const boundary = {
  detectExecutable: async (path: string) => path === 'C:\\tools\\codex.exe',
  detectVersion: async () => 'codex-cli 0.153.4',
  start: async () => ({ pid: 1, channel: { write: () => undefined, onData: () => undefined } }),
  terminate: async () => undefined,
}

describe('Codex package entry', () => {
  it('declares the entry the Desktop Host loader expects', () => {
    const provider = codexPluginManifest.contributions.find(
      (contribution) => contribution.id === 'codex-provider'
    )
    expect(provider?.entry).toBe('codex-provider.ts')
    expect(provider?.provides).toContainEqual({ id: 'harness.execution', version: '1.0.0' })
  })

  it('answers provider.describe from the supplied provider context', async () => {
    const entry = await import('./codex-provider.js')

    const contribution = entry.createProviderContribution({
      packageRoot: 'C:\\plugins\\voiceclaw-provider-codex',
      manifest: codexPluginManifest,
      contribution: codexPluginManifest.contributions[0],
      activeHostId: 'host-1',
      nativeConfiguration: configuration,
      boundary,
    })
    const described = (await contribution.invoke({
      envelope: envelope('provider.describe'),
      payload: {},
    })) as Record<string, unknown>

    expect(contribution.invoke).toBeTypeOf('function')
    expect(described).toMatchObject({
      providerId: 'codex',
      bindingId: 'binding-1',
      workspaceBindingId: 'workspace-1',
      profileStatus: 'exact',
      capabilityProfileVersion: '1.0.0',
    })
    expect(JSON.stringify(described)).not.toMatch(/os-secret|private-project|tools|codex\.exe/i)
  })

  it('refuses a context without the provider boundary or Native Provider Configuration', async () => {
    const entry = await import('./codex-provider.js')

    expect(() =>
      entry.createProviderContribution({
        packageRoot: 'C:\\plugins\\voiceclaw-provider-codex',
        manifest: codexPluginManifest,
        contribution: codexPluginManifest.contributions[0],
        activeHostId: 'host-1',
        nativeConfiguration: undefined,
        boundary: undefined,
      })
    ).toThrowError()
  })
})

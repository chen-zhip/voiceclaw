import { describe, expect, it } from 'vitest'
import { DesktopHostCredentialStore, DesktopHostRuntime } from './host-transport.js'
import { registerNativeProviderConfigurationIpc } from './native-provider-configuration-ipc.js'

describe('Native Provider Configuration', () => {
  it('uses Desktop settings storage behind secret-free IPC', async () => {
    const { DesktopSettingsStorage, NativeProviderConfigurationService } =
      await import('./native-provider-configuration.js')
    const values = new Map<string, string>()
    const database = {
      prepare: (sql: string) => ({
        get: (key: string) =>
          sql.startsWith('SELECT') && values.has(key) ? { value: values.get(key) } : undefined,
        run: (key: string, value?: string) => {
          if (sql.startsWith('INSERT') && value !== undefined) values.set(key, value)
        },
      }),
    }
    const schema = {
      preferences: {
        model: { type: 'string' as const },
        approvalPolicy: { type: 'enum' as const, values: ['ask', 'never'] },
      },
      readinessFields: [
        'providerId',
        'bindingId',
        'workspaceBindingId',
        'configured',
        'executableDetected',
      ] as const,
    }
    const credentialStore = new DesktopHostCredentialStore(
      { isEncryptionAvailable: () => true, encryptString: Buffer.from, decryptString: String },
      { write: async () => undefined, read: async () => null, clear: async () => undefined }
    )
    const firstRuntime = new DesktopHostRuntime({
      credentialStore,
      configuration: new NativeProviderConfigurationService(new DesktopSettingsStorage(database), {
        ...schema,
        readinessFields: [...schema.readinessFields],
      }),
    })
    await firstRuntime.saveNativeProviderConfiguration({
      providerId: 'codex',
      bindingId: 'binding-1',
      workspaceBindingId: 'workspace-1',
      workspacePath: 'C:\\private\\workspace',
      executable: { path: 'C:\\private\\codex.exe', args: ['app-server', '--secret-arg'] },
      preferences: { model: 'gpt-6', approvalPolicy: 'ask' },
      secretRefs: { account: 'os-secret://codex/account' },
    })

    const restartedRuntime = new DesktopHostRuntime({
      credentialStore,
      configuration: new NativeProviderConfigurationService(new DesktopSettingsStorage(database), {
        ...schema,
        readinessFields: [...schema.readinessFields],
      }),
    })
    const handlers = new Map<string, (...arguments_: unknown[]) => unknown>()
    registerNativeProviderConfigurationIpc(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      restartedRuntime
    )
    const projected = await handlers.get('desktop-host:provider-readiness')?.({}, 'binding-1', {
      configured: true,
      executableDetected: true,
      processId: 123,
      providerSessionSecret: 'session-secret',
    })

    expect(projected).toEqual({
      providerId: 'codex',
      bindingId: 'binding-1',
      workspaceBindingId: 'workspace-1',
      configured: true,
      executableDetected: true,
    })
    expect(JSON.stringify(projected)).not.toMatch(
      /private|codex\.exe|secret-arg|gpt-6|approvalPolicy|os-secret|processId|session-secret/i
    )
  })

  it('persists native settings locally and projects only approved readiness', async () => {
    const { NativeProviderConfigurationService } =
      await import('./native-provider-configuration.js')
    const values = new Map<string, string>()
    const storage = {
      get: async (key: string) => values.get(key),
      set: async (key: string, value: string) => {
        values.set(key, value)
      },
    }
    const schema = {
      preferences: {
        model: { type: 'string' as const },
        approvalPolicy: { type: 'enum' as const, values: ['ask', 'never'] },
      },
      readinessFields: [
        'providerId',
        'bindingId',
        'workspaceBindingId',
        'configured',
        'executableDetected',
      ],
    }
    const configuration = new NativeProviderConfigurationService(storage, schema)
    await configuration.save({
      providerId: 'codex',
      bindingId: 'binding-1',
      workspaceBindingId: 'workspace-1',
      workspacePath: 'C:\\workspaces\\private-project',
      executable: { path: 'C:\\tools\\codex.exe', args: ['app-server'] },
      preferences: { model: 'gpt-6', approvalPolicy: 'ask' },
      secretRefs: { account: 'os-secret://codex/account' },
    })
    await expect(
      configuration.save({
        providerId: 'codex',
        bindingId: 'binding-invalid',
        workspaceBindingId: 'workspace-1',
        workspacePath: 'C:\\workspaces\\private-project',
        executable: { path: 'C:\\tools\\codex.exe', args: [] },
        preferences: { unapproved: true },
        secretRefs: {},
      })
    ).rejects.toMatchObject({ code: 'invalid_native_configuration' })

    const restarted = new NativeProviderConfigurationService(storage, schema)
    await expect(restarted.load('binding-1')).resolves.toEqual({
      providerId: 'codex',
      bindingId: 'binding-1',
      workspaceBindingId: 'workspace-1',
      workspacePath: 'C:\\workspaces\\private-project',
      executable: { path: 'C:\\tools\\codex.exe', args: ['app-server'] },
      preferences: { model: 'gpt-6', approvalPolicy: 'ask' },
      secretRefs: { account: 'os-secret://codex/account' },
    })
    const readiness = await restarted.projectReadiness('binding-1', {
      configured: true,
      executableDetected: true,
      processId: 8472,
      transportAddress: 'ws://127.0.0.1:9000/private',
      sessionToken: 'provider-session-secret',
    })
    expect(readiness).toEqual({
      providerId: 'codex',
      bindingId: 'binding-1',
      workspaceBindingId: 'workspace-1',
      configured: true,
      executableDetected: true,
    })
    expect(JSON.stringify(readiness)).not.toMatch(
      /private-project|codex\.exe|gpt-6|os-secret|processId|transportAddress|sessionToken/i
    )
  })
})

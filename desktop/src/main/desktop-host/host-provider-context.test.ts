import { describe, expect, it, vi } from 'vitest'
import { DesktopSettingsStorage } from './native-provider-configuration.js'

function storageWith(configurations: Array<Record<string, unknown>>) {
  const values = new Map<string, string>()
  for (const configuration of configurations) {
    values.set(
      `desktop-host:native-provider-configuration:${String(configuration.bindingId)}`,
      JSON.stringify(configuration)
    )
  }
  const database = {
    prepare: (sql: string) => ({
      get: (key: string) => (values.has(key) ? { value: values.get(key) } : undefined),
      all: () => [...values.keys()].map((key) => ({ key })),
      run: (key: string, value: string) => values.set(key, value),
    }),
  }
  return new DesktopSettingsStorage(database)
}

const first = {
  providerId: 'codex',
  bindingId: 'binding-1',
  workspaceBindingId: 'workspace-1',
  workspacePath: 'C:\\workspaces\\first',
  executable: { path: 'C:\\tools\\codex.exe', args: ['app-server'] },
  preferences: { model: 'gpt-5-codex', approvalPolicy: 'never' },
  secretRefs: { accountRef: 'os-secret://codex/account' },
}

const second = {
  ...first,
  bindingId: 'binding-2',
  workspaceBindingId: 'workspace-2',
  workspacePath: 'C:\\workspaces\\second',
}

describe('Desktop Host provider context', () => {
  it('lists stored Native Provider bindings in a stable order', async () => {
    const { listNativeProviderBindings } = await import('./host-provider-context.js')

    const bindings = await listNativeProviderBindings(storageWith([second, first]))

    expect(bindings).toEqual([
      { bindingId: 'binding-1', providerId: 'codex', workspaceBindingId: 'workspace-1' },
      { bindingId: 'binding-2', providerId: 'codex', workspaceBindingId: 'workspace-2' },
    ])
  })

  it('supplies the selected binding configuration and a process boundary to the package', async () => {
    const { createHostProviderContextFactory } = await import('./host-provider-context.js')
    const boundary = { detectExecutable: async () => true }
    const createBoundary = vi.fn(() => boundary as never)

    const createProviderContext = createHostProviderContextFactory({
      storage: storageWith([first, second]),
      bindingId: 'binding-2',
      createBoundary,
    })
    const context = await createProviderContext({
      packageRoot: 'C:\\plugins\\voiceclaw-provider-codex',
      manifest: { id: 'voiceclaw-provider-codex', feature: { id: 'codex' } } as never,
      contribution: { id: 'codex-provider' } as never,
      activeHostId: 'host-1',
    })

    expect(createBoundary).toHaveBeenCalledWith('codex', second)
    expect(context).toEqual({
      nativeConfiguration: {
        bindingId: 'binding-2',
        workspaceBindingId: 'workspace-2',
        workspacePath: 'C:\\workspaces\\second',
        executablePath: 'C:\\tools\\codex.exe',
        preferences: { model: 'gpt-5-codex', approvalPolicy: 'never' },
        secretRefs: { accountRef: 'os-secret://codex/account' },
      },
      boundary,
    })
  })

  it('uses the deterministic Codex boundary when simulation is enabled', async () => {
    const { createHostProviderContextFactory } = await import('./host-provider-context.js')
    const previous = process.env.VOICECLAW_CODEX_SIMULATED
    process.env.VOICECLAW_CODEX_SIMULATED = 'true'
    try {
      const createProviderContext = createHostProviderContextFactory({
        storage: storageWith([first]),
      })
      const context = await createProviderContext({
        packageRoot: 'C:\\plugins\\voiceclaw-provider-codex',
        manifest: { id: 'voiceclaw-provider-codex', feature: { id: 'codex' } } as never,
        contribution: { id: 'codex-provider' } as never,
        activeHostId: 'host-1',
      })

      await expect(
        (context.boundary as { detectVersion(path: string): Promise<string> }).detectVersion(
          'codex'
        )
      ).resolves.toContain('(simulated)')
    } finally {
      if (previous === undefined) delete process.env.VOICECLAW_CODEX_SIMULATED
      else process.env.VOICECLAW_CODEX_SIMULATED = previous
    }
  })

  it('falls back to the first configured binding when none is selected', async () => {
    const { createHostProviderContextFactory } = await import('./host-provider-context.js')

    const createProviderContext = createHostProviderContextFactory({
      storage: storageWith([second, first]),
      createBoundary: () => ({}) as never,
    })

    await expect(
      createProviderContext({
        packageRoot: 'C:\\plugins\\voiceclaw-provider-codex',
        manifest: { id: 'voiceclaw-provider-codex', feature: { id: 'codex' } } as never,
        contribution: { id: 'codex-provider' } as never,
        activeHostId: 'host-1',
      })
    ).resolves.toMatchObject({ nativeConfiguration: { bindingId: 'binding-1' } })
  })

  it('supplies nothing when no binding is configured', async () => {
    const { createHostProviderContextFactory } = await import('./host-provider-context.js')

    const createProviderContext = createHostProviderContextFactory({
      storage: storageWith([]),
      createBoundary: () => ({}) as never,
    })

    await expect(
      createProviderContext({
        packageRoot: 'C:\\plugins\\voiceclaw-provider-codex',
        manifest: { id: 'voiceclaw-provider-codex', feature: { id: 'codex' } } as never,
        contribution: { id: 'codex-provider' } as never,
        activeHostId: 'host-1',
      })
    ).resolves.toEqual({})
  })
})

import { describe, expect, it, vi } from 'vitest'

const baseConfiguration = {
  bindingId: 'binding-1',
  workspaceBindingId: 'workspace-1',
  workspacePath: 'C:\\workspaces\\first',
  executablePath: 'C:\\tools\\codex.exe',
  preferences: { model: 'gpt-5-codex', approvalPolicy: 'never' },
  secretRefs: { accountRef: 'os-secret://codex/account' },
}

describe('Codex app-server process supervisor', () => {
  it('reuses one owned process per Active Host and Native Provider Configuration', async () => {
    const { CodexAppServerSupervisor, codexProcessIdentity } =
      await import('./app-server-process.js')
    let nextPid = 500
    const start = vi.fn(async () => ({ pid: nextPid++ }))
    const terminate = vi.fn(async (_pid: number) => undefined)
    const supervisor = new CodexAppServerSupervisor({
      detectExecutable: async () => true,
      start,
      terminate,
    })
    const identity = {
      activeHostId: 'host-1',
      nativeConfigurationIdentity: codexProcessIdentity(baseConfiguration),
    }

    const first = await supervisor.ensure({
      identity,
      executablePath: 'C:\\tools\\codex.exe',
      workspacePath: 'C:\\workspaces\\first',
    })
    const second = await supervisor.ensure({
      identity,
      executablePath: 'C:\\tools\\codex.exe',
      workspacePath: 'C:\\workspaces\\second',
    })

    expect(first).toMatchObject({ pid: 500, reused: false, ownership: 'started' })
    expect(second).toEqual({ ...first, reused: true })
    expect(start).toHaveBeenCalledTimes(1)
    expect(supervisor.status(identity)).toMatchObject({
      process: 'running',
      transport: 'disconnected',
      session: 'unavailable',
      ownership: 'started',
    })
  })

  it('keys a distinct process for a process-defining configuration change', async () => {
    const { CodexAppServerSupervisor, codexProcessIdentity } =
      await import('./app-server-process.js')
    let nextPid = 700
    const terminate = vi.fn(async (_pid: number) => undefined)
    const supervisor = new CodexAppServerSupervisor({
      detectExecutable: async () => true,
      start: async () => ({ pid: nextPid++ }),
      terminate,
    })
    const identityFor = (overrides: Record<string, unknown>) => ({
      activeHostId: 'host-1',
      nativeConfigurationIdentity: codexProcessIdentity({ ...baseConfiguration, ...overrides }),
    })

    const sameWorkspacePathChange = identityFor({ workspacePath: 'C:\\workspaces\\elsewhere' })
    expect(sameWorkspacePathChange.nativeConfigurationIdentity).toBe(
      codexProcessIdentity(baseConfiguration)
    )
    expect(identityFor({ executablePath: 'C:\\tools\\other.exe' })).not.toEqual(
      identityFor({ executablePath: baseConfiguration.executablePath })
    )
    expect(identityFor({ secretRefs: { accountRef: 'os-secret://codex/other' } })).not.toEqual(
      identityFor({ secretRefs: baseConfiguration.secretRefs })
    )
    expect(identityFor({ preferences: { model: 'gpt-5', approvalPolicy: 'never' } })).not.toEqual(
      identityFor({ preferences: baseConfiguration.preferences })
    )

    const first = await supervisor.ensure({
      identity: identityFor({}),
      executablePath: 'C:\\tools\\codex.exe',
      workspacePath: 'C:\\workspaces\\first',
    })
    const isolated = await supervisor.ensure({
      identity: identityFor({ preferences: { model: 'gpt-5', approvalPolicy: 'never' } }),
      executablePath: 'C:\\tools\\codex.exe',
      workspacePath: 'C:\\workspaces\\first',
    })

    expect(isolated.pid).not.toBe(first.pid)
    expect(isolated.reused).toBe(false)
    expect(supervisor.status(identityFor({})).process).toBe('running')
    expect(terminate).not.toHaveBeenCalled()
  })

  it('terminates only the processes Desktop owns', async () => {
    const { CodexAppServerSupervisor, codexProcessIdentity } =
      await import('./app-server-process.js')
    const terminate = vi.fn(async (_pid: number) => undefined)
    const supervisor = new CodexAppServerSupervisor({
      detectExecutable: async () => true,
      start: async () => ({ pid: 800 }),
      terminate,
    })
    const owned = {
      activeHostId: 'host-1',
      nativeConfigurationIdentity: codexProcessIdentity(baseConfiguration),
    }
    const external = { activeHostId: 'host-2', nativeConfigurationIdentity: 'external-config' }

    await supervisor.ensure({
      identity: owned,
      executablePath: 'C:\\tools\\codex.exe',
      workspacePath: 'C:\\workspaces\\first',
    })
    supervisor.reportTransport(owned, true)
    supervisor.reportSession(owned, true)
    expect(supervisor.status(owned)).toMatchObject({ transport: 'ready', session: 'ready' })
    await supervisor.connectExternal(external, { pid: 900 })

    await supervisor.shutdown()
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(terminate).toHaveBeenCalledWith(800)
    expect(supervisor.status(external)).toMatchObject({
      process: 'running',
      ownership: 'external',
    })
  })

  it('does not start a process when the Codex executable is missing', async () => {
    const { CodexAppServerSupervisor, codexProcessIdentity } =
      await import('./app-server-process.js')
    const start = vi.fn(async () => ({ pid: 1 }))
    const supervisor = new CodexAppServerSupervisor({
      detectExecutable: async () => false,
      start,
      terminate: async () => undefined,
    })

    await expect(
      supervisor.ensure({
        identity: {
          activeHostId: 'host-1',
          nativeConfigurationIdentity: codexProcessIdentity(baseConfiguration),
        },
        executablePath: 'C:\\tools\\codex.exe',
        workspacePath: 'C:\\workspaces\\first',
      })
    ).rejects.toMatchObject({ code: 'codex_executable_not_found' })
    expect(start).not.toHaveBeenCalled()
  })
})

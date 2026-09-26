import { describe, expect, it } from 'vitest'

const configuration = {
  bindingId: 'binding-1',
  workspaceBindingId: 'workspace-1',
  workspacePath: 'C:\\workspaces\\private-project',
  executablePath: 'C:\\tools\\codex.exe',
  preferences: { model: 'gpt-5-codex', approvalPolicy: 'never' },
  secretRefs: { accountRef: 'os-secret://codex/account' },
}

describe('Codex availability', () => {
  it('describes the executable, Workspace, preferences, and secret references', async () => {
    const { CodexAvailabilityService } = await import('./codex-availability.js')
    const service = new CodexAvailabilityService({
      detectExecutable: async (path) => path === 'C:\\tools\\codex.exe',
    })

    const descriptor = await service.describe({
      configuration,
      runtime: { process: 'running', transport: 'ready', session: 'ready' },
      detectedVersion: '0.153.4',
    })

    expect(descriptor.configuration).toEqual({
      bindingId: 'binding-1',
      workspaceBindingId: 'workspace-1',
      workspacePath: 'C:\\workspaces\\private-project',
      executablePath: 'C:\\tools\\codex.exe',
      preferences: { model: 'gpt-5-codex', approvalPolicy: 'never' },
      secretReferences: ['accountRef'],
    })
    expect(descriptor.readiness).toEqual({
      contribution: 'ACTIVE',
      executable: 'detected',
      process: 'running',
      transport: 'ready',
      session: 'ready',
    })
    expect(descriptor.profile).toMatchObject({ status: 'exact', profileVersion: '0.153.4' })
    expect(descriptor.canDispatch).toBe(true)
    expect(descriptor.guidance).toEqual([])
  })

  it('reports unavailable guidance without dispatch when the executable is missing', async () => {
    const { CodexAvailabilityService } = await import('./codex-availability.js')
    const service = new CodexAvailabilityService({ detectExecutable: async () => false })

    const descriptor = await service.describe({
      configuration,
      runtime: { process: 'stopped', transport: 'disconnected', session: 'unavailable' },
      detectedVersion: '0.153.4',
    })

    expect(descriptor.readiness).toEqual({
      contribution: 'DEGRADED',
      executable: 'missing',
      process: 'stopped',
      transport: 'disconnected',
      session: 'unavailable',
    })
    expect(descriptor.canDispatch).toBe(false)
    expect(descriptor.guidance).toEqual([
      'Set the Codex executable path to an installed codex-cli 0.153.4 binary.',
    ])
  })

  it('keeps Session readiness separate from Contribution availability', async () => {
    const { CodexAvailabilityService } = await import('./codex-availability.js')
    const service = new CodexAvailabilityService({ detectExecutable: async () => true })

    const descriptor = await service.describe({
      configuration,
      runtime: { process: 'running', transport: 'ready', session: 'unavailable' },
      detectedVersion: '0.153.4',
    })

    expect(descriptor.readiness.contribution).toBe('ACTIVE')
    expect(descriptor.readiness).toMatchObject({
      executable: 'detected',
      process: 'running',
      transport: 'ready',
      session: 'unavailable',
    })
    expect(descriptor.canDispatch).toBe(false)
    expect(descriptor.guidance).toEqual([
      'Authenticate Codex locally; VoiceClaw never receives Codex credential material.',
    ])
  })

  it('projects readiness without secret material', async () => {
    const { CodexAvailabilityService, projectCodexAvailability } =
      await import('./codex-availability.js')
    const service = new CodexAvailabilityService({ detectExecutable: async () => true })
    const descriptor = await service.describe({
      configuration,
      runtime: { process: 'running', transport: 'ready', session: 'ready' },
      detectedVersion: '0.153.9',
    })

    const projection = projectCodexAvailability(descriptor)
    expect(projection).toEqual({
      providerId: 'codex',
      bindingId: 'binding-1',
      workspaceBindingId: 'workspace-1',
      capabilityProfileVersion: '1.0.0',
      profileStatus: 'unverified',
      readiness: {
        contribution: 'ACTIVE',
        executable: 'detected',
        process: 'running',
        transport: 'ready',
        session: 'ready',
      },
      warnings: [
        {
          code: 'unverified-codex-version',
          detectedVersion: '0.153.9',
          profileVersion: '0.153.4',
          message: 'Codex 0.153.9 is not an exactly verified Capability Profile',
        },
      ],
    })
    expect(JSON.stringify(projection)).not.toMatch(
      /os-secret|private-project|tools|codex\.exe|gpt-5-codex|account/i
    )
  })

  it('rejects a configuration that does not match the package schema', async () => {
    const { CodexAvailabilityService } = await import('./codex-availability.js')
    const service = new CodexAvailabilityService({ detectExecutable: async () => true })

    await expect(
      service.describe({
        configuration: {
          bindingId: 'binding-1',
          workspaceBindingId: 'workspace-1',
          preferences: { unsupported: true },
          secretRefs: {},
        },
        runtime: { process: 'stopped', transport: 'disconnected', session: 'unavailable' },
        detectedVersion: '0.153.4',
      })
    ).rejects.toMatchObject({ code: 'invalid_codex_configuration' })
  })
})

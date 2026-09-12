import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DesktopHostConnectionGateway } from '../../src/desktop-host/host-connection.js'
import { RemoteHostEnrollmentService } from '../../src/desktop-host/host-enrollment.js'
import { ControlStateStore } from '../../src/plugin-kernel/control-state-store.js'
import { PhaseZeroKernel } from '../../src/plugin-kernel/phase-zero-kernel.js'

describe('Host Contribution registration', () => {
  it('loads Host Contributions through Kernel Phase Zero', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-host-kernel-loading-'))
    const packagesRoot = join(directory, 'packages')
    const packageRoot = join(packagesRoot, 'voiceclaw-codex')
    await mkdir(join(packageRoot, 'dist'), { recursive: true })
    await Promise.all([
      writeFile(join(packageRoot, 'dist', 'provider.js'), 'export {}'),
      writeFile(join(packageRoot, 'dist', 'settings.js'), 'export {}'),
    ])
    await writeFile(
      join(packageRoot, 'voiceclaw.plugin.json'),
      JSON.stringify({
        manifestVersion: 0,
        id: 'voiceclaw-codex',
        version: '1.2.3',
        voiceclawVersionRange: '>=0.1.0 <0.2.0',
        feature: { id: 'codex', displayName: 'Codex' },
        contributions: [
          {
            id: 'codex-provider',
            type: 'provider-integration',
            runtime: 'desktop',
            entry: 'dist/provider.js',
            provides: [
              { id: 'harness.execution', version: '1.0.0' },
              { id: 'harness.capability-profile', version: '1.0.0' },
            ],
            requires: [],
            configSchema: { type: 'object' },
            requestedPermissions: [],
          },
          {
            id: 'codex-settings',
            type: 'client-ui',
            runtime: 'desktop',
            entry: 'dist/settings.js',
            provides: [{ id: 'provider.settings', version: '1.0.0' }],
            requires: [],
            configSchema: { type: 'object' },
            requestedPermissions: [],
          },
        ],
        lifecycle: {
          activation: 'startup',
          disable: 'restart-required',
          update: 'restart-required',
          uninstall: 'unsupported',
          dataDisposition: 'retain',
        },
      })
    )
    const kernel = await PhaseZeroKernel.bootstrap({
      shippedRoots: [],
      developmentAllowlistedRoots: [packagesRoot],
      voiceclawVersion: '0.1.0',
      controlStatePath: join(directory, 'kernel-control-state.json'),
      selectedProviders: {
        'harness.execution': {
          packageId: 'voiceclaw-codex',
          contributionId: 'codex-provider',
        },
      },
      configurations: {},
      assignments: [],
      grants: [
        {
          id: 'grant-codex-host',
          principalId: 'voiceclaw-codex:codex-provider',
          contractId: 'harness.execution',
          operation: 'turn.start',
          scope: { kind: 'workspace', id: 'workspace-1' },
          secretRefs: [],
          workspaceBindings: ['workspace-1'],
          revoked: false,
        },
      ],
      loadContribution: async () => ({ invoke: async () => ({}) }),
    })

    const store = await ControlStateStore.open(join(directory, 'host-control-state.json'), {
      requester: { kind: 'relay-authority', id: 'desktop-host-gateway' },
    })
    const secrets = ['enrollment-token', 'host-credential']
    const enrollment = new RemoteHostEnrollmentService(store, {
      createSecret: () => secrets.shift() as string,
      createHostId: () => 'host-1',
      authorizeOwner: () => true,
    })
    const token = await enrollment.issueToken({
      principal: { kind: 'user', id: 'owner-1' },
      installationId: 'installation-1',
    })
    const enrolled = await enrollment.exchangeToken({ token: token.token })
    const connections = new DesktopHostConnectionGateway(store)
    const principal = await connections.admit({
      mode: 'remote',
      credential: { kind: 'host', value: enrolled.credential },
    })
    const { HostContributionRegistry } =
      await import('../../src/desktop-host/provider-registration.js')
    const registry = new HostContributionRegistry(connections)

    expect(() =>
      registry.loadFromKernel(
        { kind: 'desktop-host', id: 'not-connected' },
        kernel,
        { 'voiceclaw-codex:codex-provider': 'codex' },
        {
          'voiceclaw-codex:codex-provider': {
            executable: 'detected',
            process: 'running',
            transport: 'ready',
            session: 'unavailable',
          },
        }
      )
    ).toThrowError(expect.objectContaining({ code: 'invalid_host_registration' }))
    registry.loadFromKernel(
      principal,
      kernel,
      { 'voiceclaw-codex:codex-provider': 'codex' },
      {
        'voiceclaw-codex:codex-provider': {
          executable: 'detected',
          process: 'running',
          transport: 'ready',
          session: 'unavailable',
        },
      }
    )

    expect(registry.projectHost('host-1')).toEqual([
      expect.objectContaining({
        packageId: 'voiceclaw-codex',
        contributionId: 'codex-provider',
        providerId: 'codex',
        harnessVersion: '1.0.0',
        capabilityProfileVersion: '1.0.0',
        state: 'DEGRADED',
        granted: true,
      }),
      expect.objectContaining({
        contributionId: 'codex-settings',
        state: 'ACTIVE',
        readiness: null,
      }),
    ])
  })

  it('keeps Contribution state separate from Provider Session readiness', async () => {
    const { HostContributionRegistry } =
      await import('../../src/desktop-host/provider-registration.js')
    const registry = new HostContributionRegistry()
    const hostPrincipal = { kind: 'desktop-host' as const, id: 'host-1' }
    registry.register(hostPrincipal, {
      packageId: 'voiceclaw-codex',
      contributionId: 'codex-provider',
      category: 'provider-integration',
      providerId: 'codex',
      harnessVersion: '1.2.3',
      capabilityProfileVersion: '1.0.0',
      provides: [{ id: 'harness.execution', version: '1.0.0' }],
      requires: [],
      state: 'ACTIVE',
    })
    registry.register(hostPrincipal, {
      packageId: 'voiceclaw-codex',
      contributionId: 'codex-settings',
      category: 'client-ui',
      providerId: 'codex',
      harnessVersion: '1.2.3',
      capabilityProfileVersion: '1.0.0',
      provides: [{ id: 'provider.settings', version: '1.0.0' }],
      requires: [],
      state: 'ACTIVE',
    })
    registry.reportReadiness(hostPrincipal, 'voiceclaw-codex:codex-provider', {
      executable: 'missing',
      process: 'stopped',
      transport: 'disconnected',
      session: 'unavailable',
    })

    const projection = registry.projectHost('host-1')
    expect(projection).toEqual([
      expect.objectContaining({
        contributionId: 'codex-provider',
        state: 'DEGRADED',
        callable: true,
        readiness: {
          executable: 'missing',
          process: 'stopped',
          transport: 'disconnected',
          session: 'unavailable',
        },
      }),
      expect.objectContaining({
        contributionId: 'codex-settings',
        state: 'ACTIVE',
        callable: true,
        readiness: null,
      }),
    ])
    expect(JSON.stringify(projection)).not.toMatch(
      /credential|secret|workspacePath|executablePath/i
    )
    expect(() =>
      registry.register(hostPrincipal, {
        packageId: 'voiceclaw-codex',
        contributionId: 'leaking-provider',
        category: 'provider-integration',
        providerId: 'codex',
        harnessVersion: '1.2.3',
        capabilityProfileVersion: '1.0.0',
        provides: [],
        requires: [],
        state: 'ACTIVE',
        credential: 'must-not-cross',
      })
    ).toThrowError(expect.objectContaining({ code: 'invalid_host_registration' }))
  })
})

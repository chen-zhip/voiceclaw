import { BundledLocalHostBootstrap, DesktopHostConnectionGateway } from './host-connection.js'
import { HostContributionRegistry } from './provider-registration.js'
import { ControlStateStore } from '../plugin-kernel/control-state-store.js'
import { bootstrapPhaseZeroProfile } from '../plugin-kernel/phase-zero-profile.js'

type Authentication =
  | { mode: 'remote'; credential: string }
  | {
      mode: 'local'
      stackId: string
      credential: string
      bootstrap: BundledLocalHostBootstrap
    }

export async function bootstrapDesktopHostMinimalProfile(input: {
  controlStatePath: string
  authentication: Authentication
}) {
  const initialStore = await ControlStateStore.open(input.controlStatePath, {
    requester: { kind: 'relay-authority', id: 'desktop-host-profile' },
  })
  if (!initialStore.read().grants.some((grant) => grant.id === 'grant-routing-harness-execution')) {
    await initialStore.commit((state) => ({
      ...state,
      grants: [
        ...state.grants,
        {
          id: 'grant-routing-harness-execution',
          principalId: 'voiceclaw-routing:routing',
          contractId: 'harness.execution',
          operation: 'turn.start',
          scope: { kind: 'workspace' },
          secretRefs: [],
          workspaceBindings: [],
          revoked: false,
        },
      ],
    }))
  }

  const profile = await bootstrapPhaseZeroProfile({
    controlStatePath: input.controlStatePath,
    contributions: [
      {
        id: 'harness-provider',
        packageId: 'voiceclaw-desktop-host',
        feature: { id: 'desktop-host', displayName: 'Desktop Host' },
        version: '1.0.0',
        type: 'provider-integration',
        runtime: 'desktop',
        provides: [{ id: 'harness.execution', version: '1.0.0' }],
        requires: [],
        readiness: { process: true, transport: true, session: true },
      },
      {
        id: 'routing',
        packageId: 'voiceclaw-routing',
        feature: { id: 'routing', displayName: 'Harness Routing' },
        version: '1.0.0',
        type: 'relay-service',
        runtime: 'relay',
        provides: [],
        requires: [{ id: 'harness.execution', range: '^1.0.0' }],
      },
    ],
    optionalCapabilities: [
      { id: 'archive.read', range: '^1.0.0' },
      { id: 'memory.read', range: '^1.0.0' },
    ],
  })

  const gateway = new DesktopHostConnectionGateway(profile.controlStateStore, {
    ...(input.authentication.mode === 'local'
      ? { localBootstrap: input.authentication.bootstrap }
      : {}),
  })
  const principal =
    input.authentication.mode === 'remote'
      ? await gateway.admit({
          mode: 'remote',
          credential: { kind: 'host', value: input.authentication.credential },
        })
      : await gateway.admit({
          mode: 'local',
          stackId: input.authentication.stackId,
          credential: { kind: 'local-bootstrap', value: input.authentication.credential },
        })

  const registry = new HostContributionRegistry()
  registry.register(principal, {
    packageId: 'voiceclaw-desktop-host',
    contributionId: 'harness-provider',
    category: 'provider-integration',
    providerId: 'fixture',
    harnessVersion: '1.0.0',
    capabilityProfileVersion: '1.0.0',
    provides: [{ id: 'harness.execution', version: '1.0.0' }],
    requires: [],
    state: 'ACTIVE',
  })
  const readiness = {
    executable: 'detected' as const,
    process: 'running' as const,
    transport: 'ready' as const,
    session: 'ready' as const,
  }
  registry.reportReadiness(principal, 'voiceclaw-desktop-host:harness-provider', readiness)

  return {
    principal,
    readiness,
    harnessContribution: {
      packageId: 'voiceclaw-desktop-host',
      contributionId: 'harness-provider',
      contract: { id: 'harness.execution', version: '1.0.0' },
      state: registry.projectHost(principal.id)[0].state,
      granted: true,
    },
    effectiveGraph: profile.effectiveGraph,
    controlStateStore: profile.controlStateStore,
  }
}

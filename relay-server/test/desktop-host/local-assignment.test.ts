import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ControlStateStore } from '../../src/plugin-kernel/control-state-store.js'
import { declaredLocalBindings, seedLocalProfile } from '../../src/desktop-host/local-profile.js'
import { localProviderConfigurations } from '../../src/desktop-host/local-profile.js'

const relayAuthority = { kind: 'relay-authority' as const, id: 'local-profile' }

async function store() {
  const directory = await mkdtemp(join(tmpdir(), 'local-profile-'))
  return ControlStateStore.open(join(directory, 'control-state.json'), {
    requester: relayAuthority,
  })
}

const environment = {
  VOICECLAW_LOCAL_HOST_ID: 'local-host-1',
  VOICECLAW_HARNESS_PACKAGE_ID: 'voiceclaw-provider-codex',
  VOICECLAW_HARNESS_CONTRIBUTION_ID: 'codex-provider',
  VOICECLAW_LOCAL_BINDINGS: JSON.stringify([
    {
      bindingId: 'binding-1',
      providerId: 'codex',
      workspaceBindingId: 'workspace-1',
      workspacePath: 'C:\\workspaces\\first',
    },
  ]),
}

describe('Local stack profile seeding', () => {
  it('reads declared local bindings and ignores anything else', () => {
    expect(declaredLocalBindings(environment)).toEqual([
      { bindingId: 'binding-1', providerId: 'codex', workspaceBindingId: 'workspace-1' },
    ])
    expect(declaredLocalBindings({})).toEqual([])
    expect(declaredLocalBindings({ VOICECLAW_LOCAL_BINDINGS: '{not json' })).toEqual([])
    expect(
      declaredLocalBindings({ VOICECLAW_LOCAL_BINDINGS: JSON.stringify([{ bindingId: 'only' }]) })
    ).toEqual([])
  })

  it('maps the declared bindings onto the selected Harness contribution configuration', () => {
    expect(localProviderConfigurations(environment)).toEqual({
      'voiceclaw-provider-codex:codex-provider': { workspacePath: 'C:\\workspaces\\first' },
    })
    expect(
      localProviderConfigurations({
        ...environment,
        VOICECLAW_HARNESS_PACKAGE_ID: undefined,
      })
    ).toEqual({})
    expect(
      localProviderConfigurations({
        ...environment,
        VOICECLAW_LOCAL_BINDINGS: JSON.stringify([
          { bindingId: 'binding-1', providerId: 'codex', workspaceBindingId: 'workspace-1' },
        ]),
      })
    ).toEqual({})
  })

  it('seeds harness.execution grants and the binding assignment for the local Host', async () => {
    const controlState = await store()

    const result = await seedLocalProfile({ store: controlState, environment })

    const state = controlState.read()
    expect(result).toEqual({ grants: 4, assignments: 1 })
    expect(state.grants.map((grant) => grant.operation).sort()).toEqual([
      'provider.describe',
      'thread.ensure',
      'turn.cancel',
      'turn.start',
    ])
    expect(state.grants.every((grant) => grant.contractId === 'harness.execution')).toBe(true)
    expect(state.grants.every((grant) => grant.principalId === 'routing')).toBe(true)
    expect(state.grants.every((grant) => grant.workspaceBindings.includes('workspace-1'))).toBe(
      true
    )
    expect(state.assignments).toEqual([
      {
        bindingId: 'binding-1',
        hostId: 'local-host-1',
        providerId: 'codex',
        workspaceBindingId: 'workspace-1',
        generation: 1,
      },
    ])
  })

  it('stays idempotent and refreshes the generation when the identity changes', async () => {
    const controlState = await store()
    await seedLocalProfile({ store: controlState, environment })

    await expect(seedLocalProfile({ store: controlState, environment })).resolves.toEqual({
      grants: 0,
      assignments: 0,
    })
    expect(controlState.read().assignments[0].generation).toBe(1)

    await seedLocalProfile({
      store: controlState,
      environment: {
        ...environment,
        VOICECLAW_LOCAL_BINDINGS: JSON.stringify([
          { bindingId: 'binding-1', providerId: 'codex', workspaceBindingId: 'workspace-2' },
        ]),
      },
    })
    expect(controlState.read().assignments[0]).toMatchObject({
      workspaceBindingId: 'workspace-2',
      generation: 2,
    })
  })

  it('seeds nothing without declared bindings or a local host identity', async () => {
    const controlState = await store()

    await expect(seedLocalProfile({ store: controlState, environment: {} })).resolves.toEqual({
      grants: 0,
      assignments: 0,
    })
    expect(controlState.read().grants).toEqual([])
    expect(controlState.read().assignments).toEqual([])
  })
})

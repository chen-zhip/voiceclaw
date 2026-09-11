import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ControlStateStore } from '../../src/plugin-kernel/control-state-store.js'
import * as grantsModule from '../../src/plugin-kernel/capability-grants.js'

describe('Capability Grants', () => {
  it('fails closed on exact operation and Scope while persisting revocation', async () => {
    const CapabilityGrantEvaluator = (grantsModule as Record<string, unknown>)
      .CapabilityGrantEvaluator as
      | (new (store: ControlStateStore) => {
          authorize(
            request: Record<string, unknown>
          ): { authorized: true; grantId: string } | { authorized: false; reason: string }
          revoke(grantId: string): Promise<void>
          auditEvents(): Array<Record<string, unknown>>
        })
      | undefined

    expect(typeof CapabilityGrantEvaluator).toBe('function')
    if (!CapabilityGrantEvaluator) return

    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-grants-'))
    const path = join(directory, 'control-state.json')
    const store = await ControlStateStore.open(path, {
      requester: { kind: 'relay-authority', id: 'kernel' },
    })
    await store.commit((state) => ({
      ...state,
      grants: [
        {
          id: 'grant-routing-turn',
          principalId: 'routing',
          contractId: 'harness.execution',
          operation: 'turn.start',
          scope: { kind: 'workspace', id: 'workspace-1' },
          secretRefs: ['codex-account'],
          workspaceBindings: ['workspace-1'],
          revoked: false,
        },
      ],
    }))
    const evaluator = new CapabilityGrantEvaluator(store)
    const allowed = {
      principalId: 'routing',
      contractId: 'harness.execution',
      operation: 'turn.start',
      scope: { kind: 'workspace', id: 'workspace-1' },
      secretRef: 'codex-account',
      workspaceBindingId: 'workspace-1',
    }
    expect(evaluator.authorize(allowed)).toEqual({
      authorized: true,
      grantId: 'grant-routing-turn',
    })

    for (const denied of [
      { ...allowed, operation: 'turn.cancel' },
      { ...allowed, scope: { kind: 'workspace', id: 'workspace-2' } },
      { ...allowed, secretRef: 'other-secret' },
      { ...allowed, workspaceBindingId: 'workspace-2' },
      {
        principalId: 'plugin-with-request-only',
        contractId: 'harness.execution',
        operation: 'turn.start',
        scope: { kind: 'workspace', id: 'workspace-1' },
        requestedPermissions: ['harness.execution:turn.start'],
      },
    ]) {
      expect(evaluator.authorize(denied)).toMatchObject({ authorized: false })
    }
    expect(JSON.stringify(evaluator.auditEvents())).not.toContain('other-secret')
    expect(JSON.stringify(evaluator.auditEvents())).not.toContain('requestedPermissions')

    await evaluator.revoke('grant-routing-turn')
    const reopened = await ControlStateStore.open(path, {
      requester: { kind: 'relay-authority', id: 'kernel' },
    })
    const afterRestart = new CapabilityGrantEvaluator(reopened)
    expect(afterRestart.authorize(allowed)).toEqual({
      authorized: false,
      reason: 'No current Capability Grant',
    })
  })
})

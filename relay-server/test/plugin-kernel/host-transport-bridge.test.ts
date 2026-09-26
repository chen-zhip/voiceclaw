import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PhaseZeroKernel } from '../../src/plugin-kernel/phase-zero-kernel.js'

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), 'kernel-host-bridge-'))
  const packageRoot = join(root, 'voiceclaw-fixture')
  await mkdir(packageRoot, { recursive: true })
  await writeFile(join(packageRoot, 'provider.js'), 'export {}\n', 'utf8')
  await writeFile(
    join(packageRoot, 'voiceclaw.plugin.json'),
    JSON.stringify({
      manifestVersion: 0,
      id: 'voiceclaw-fixture',
      version: '1.0.0',
      voiceclawVersionRange: '>=0.1.0 <0.2.0',
      feature: { id: 'fixture', displayName: 'Fixture' },
      contributions: [
        {
          id: 'fixture-host',
          type: 'provider-integration',
          runtime: 'desktop',
          entry: 'provider.js',
          provides: [{ id: 'harness.execution', version: '1.0.0' }],
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
    }),
    'utf8'
  )
  return root
}

describe('Kernel Host transport bridge', () => {
  it('dispatches a routed invocation to the Desktop Host instead of an in-process contribution', async () => {
    const root = await fixtureRoot()
    const calls: Array<{ hostId: string; providerId: string }> = []
    const kernel = await PhaseZeroKernel.bootstrap({
      shippedRoots: [],
      developmentAllowlistedRoots: [root],
      voiceclawVersion: '0.1.0',
      controlStatePath: join(root, 'control-state.json'),
      selectedProviders: {
        'harness.execution': { packageId: 'voiceclaw-fixture', contributionId: 'fixture-host' },
      },
      configurations: {},
      assignments: [
        {
          bindingId: 'binding-1',
          hostId: 'local-host-1',
          providerId: 'fixture',
          workspaceBindingId: 'workspace-1',
          generation: 1,
        },
      ],
      grants: ['turn.start'].map((operation) => ({
        id: `grant-${operation}`,
        principalId: 'voiceclaw-fixture:routing',
        contractId: 'harness.execution',
        operation,
        scope: { kind: 'workspace', id: 'workspace-1' },
        secretRefs: [],
        workspaceBindings: ['workspace-1'],
        revoked: false,
      })),
      loadContribution: async () => ({
        invoke: async () => {
          throw new Error('in-process dispatch must not be used for a routed Host')
        },
      }),
      hostTransport: {
        invoke: async (input) => {
          calls.push({ hostId: input.hostId, providerId: input.providerId })
          return {
            events: [
              {
                invocationId: input.envelope.invocationId,
                bindingId: 'binding-1',
                threadId: 'thread-1',
                turnId: 'turn-1',
                attemptId: 'attempt-1',
                generation: 1,
                sequence: 1,
                kind: 'terminal' as const,
                payload: { outcome: 'completed' },
              },
            ],
          }
        },
      },
    })

    const result = await kernel.invoke(
      {
        contract: { id: 'harness.execution', version: '1.0.0' },
        operation: 'turn.start',
        invocationId: 'invocation-1',
        principal: { kind: 'contribution', id: 'voiceclaw-fixture:routing' },
        scope: { kind: 'workspace', id: 'workspace-1' },
        selectedContribution: { packageId: 'voiceclaw-fixture', contributionId: 'fixture-host' },
        generation: 1,
        trace: { traceId: 'trace-1' },
        cancellation: { supported: true, token: 'cancel-1' },
      },
      {
        bindingId: 'binding-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        attemptId: 'attempt-1',
        generation: 1,
        input: { text: 'hello' },
      },
      { authenticatedPrincipal: { kind: 'contribution', id: 'voiceclaw-fixture:routing' } }
    )

    expect(calls).toEqual([{ hostId: 'local-host-1', providerId: 'fixture' }])
    expect(result).toEqual({
      events: [expect.objectContaining({ kind: 'terminal', payload: { outcome: 'completed' } })],
    })
  })
})

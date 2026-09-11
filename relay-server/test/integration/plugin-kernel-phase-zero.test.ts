import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as kernelModule from '../../src/plugin-kernel/phase-zero-kernel.js'

describe('deterministic Phase 0 invocation', () => {
  it('loads one allowlisted package and completes harness.execution@1', async () => {
    const PhaseZeroKernel = (kernelModule as Record<string, unknown>).PhaseZeroKernel as
      | {
          bootstrap(options: Record<string, unknown>): Promise<{
            effectiveGraph(): unknown
            disposeContribution(identity: {
              packageId: string
              contributionId: string
            }): Promise<void>
            invoke(
              envelope: unknown,
              payload: unknown,
              context: { authenticatedPrincipal: { kind: 'contribution'; id: string } }
            ): Promise<{ events: unknown[] } | { result: unknown }>
          }>
        }
      | undefined
    expect(typeof PhaseZeroKernel?.bootstrap).toBe('function')
    if (!PhaseZeroKernel) return

    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-phase-zero-'))
    const packagesRoot = join(directory, 'packages')
    const packageRoot = join(packagesRoot, 'voiceclaw-fixture')
    await mkdir(join(packageRoot, 'dist'), { recursive: true })
    await Promise.all([
      writeFile(join(packageRoot, 'dist', 'host.js'), 'export {}'),
      writeFile(join(packageRoot, 'dist', 'routing.js'), 'export {}'),
      writeFile(join(packageRoot, 'dist', 'missing.js'), 'export {}'),
      writeFile(join(packageRoot, 'dist', 'broken.js'), 'export {}'),
      writeFile(join(packageRoot, 'dist', 'invalid-config.js'), 'export {}'),
    ])
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
            entry: 'dist/host.js',
            provides: [
              { id: 'harness.execution', version: '1.0.0' },
              { id: 'provider.status', version: '1.0.0' },
            ],
            requires: [],
            configSchema: { type: 'object' },
            requestedPermissions: [],
          },
          {
            id: 'routing',
            type: 'desktop-service',
            runtime: 'relay',
            entry: 'dist/routing.js',
            provides: [],
            requires: [
              { id: 'harness.execution', range: '^1.0.0' },
              { id: 'provider.status', range: '^1.0.0' },
            ],
            configSchema: { type: 'object' },
            requestedPermissions: [],
          },
          {
            id: 'missing-consumer',
            type: 'desktop-service',
            runtime: 'relay',
            entry: 'dist/missing.js',
            provides: [],
            requires: [{ id: 'archive.read', range: '^1.0.0' }],
            configSchema: { type: 'object' },
            requestedPermissions: [],
          },
          {
            id: 'broken-independent',
            type: 'desktop-service',
            runtime: 'relay',
            entry: 'dist/broken.js',
            provides: [],
            requires: [],
            configSchema: { type: 'object' },
            requestedPermissions: [],
          },
          {
            id: 'invalid-config',
            type: 'desktop-service',
            runtime: 'relay',
            entry: 'dist/invalid-config.js',
            provides: [],
            requires: [],
            configSchema: {
              type: 'object',
              required: ['enabled'],
              properties: { enabled: { type: 'boolean' } },
              additionalProperties: false,
            },
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

    const disposeHost = vi.fn(async () => undefined)
    const disposeRouting = vi.fn(async () => undefined)
    const loadContribution = vi.fn(async ({ contribution }: { contribution: { id: string } }) => {
      if (contribution.id === 'broken-independent') throw new Error('fixture load failure')
      return {
        invoke: async ({
          envelope,
          payload,
        }: {
          envelope: { operation: string }
          payload: { generation: number; input: { text: string } }
        }) =>
          envelope.operation === 'provider.describe'
            ? { providerId: 'fixture', displayName: 'Fixture provider' }
            : [
                {
                  invocationId: 'invocation-1',
                  bindingId: 'binding-1',
                  threadId: 'thread-1',
                  turnId: 'turn-1',
                  attemptId: 'attempt-1',
                  generation: payload.generation,
                  sequence: 1,
                  kind: 'semantic-output',
                  payload:
                    payload.input.text === 'private'
                      ? { text: 'unsafe answer', metadata: { privateReasoning: 'hidden trace' } }
                      : { text: 'deterministic answer' },
                },
                {
                  invocationId: 'invocation-1',
                  bindingId: 'binding-1',
                  threadId: 'thread-1',
                  turnId: 'turn-1',
                  attemptId: 'attempt-1',
                  generation: payload.generation,
                  sequence: 2,
                  kind: 'terminal',
                  payload: { outcome: 'completed' },
                },
              ],
        ...(contribution.id === 'fixture-host' ? { dispose: disposeHost } : {}),
        ...(contribution.id === 'routing' ? { dispose: disposeRouting } : {}),
      }
    })
    const kernel = await PhaseZeroKernel.bootstrap({
      shippedRoots: [],
      developmentAllowlistedRoots: [packagesRoot],
      voiceclawVersion: '0.1.0',
      controlStatePath: join(directory, 'control-state.json'),
      selectedProviders: {
        'harness.execution': {
          packageId: 'voiceclaw-fixture',
          contributionId: 'fixture-host',
        },
        'provider.status': {
          packageId: 'voiceclaw-fixture',
          contributionId: 'fixture-host',
        },
      },
      configurations: {
        'voiceclaw-fixture:fixture-host': {},
        'voiceclaw-fixture:routing': {},
        'voiceclaw-fixture:missing-consumer': {},
        'voiceclaw-fixture:broken-independent': {},
        'voiceclaw-fixture:invalid-config': { enabled: 'yes' },
      },
      assignments: [
        {
          bindingId: 'binding-1',
          hostId: 'voiceclaw-fixture:fixture-host',
          generation: 1,
        },
      ],
      grants: [
        {
          id: 'grant-routing',
          principalId: 'voiceclaw-fixture:routing',
          contractId: 'harness.execution',
          operation: 'turn.start',
          scope: { kind: 'workspace', id: 'workspace-1' },
          secretRefs: [],
          workspaceBindings: ['workspace-1'],
          revoked: false,
        },
        {
          id: 'grant-routing-status',
          principalId: 'voiceclaw-fixture:routing',
          contractId: 'provider.status',
          operation: 'read',
          scope: { kind: 'workspace', id: 'workspace-1' },
          secretRefs: [],
          workspaceBindings: ['workspace-1'],
          revoked: false,
        },
        {
          id: 'grant-routing-describe',
          principalId: 'voiceclaw-fixture:routing',
          contractId: 'harness.execution',
          operation: 'provider.describe',
          scope: { kind: 'workspace', id: 'workspace-1' },
          secretRefs: [],
          workspaceBindings: ['workspace-1'],
          revoked: false,
        },
      ],
      loadContribution,
    })

    expect(loadContribution.mock.calls.map(([input]) => input.contribution.id)).toEqual([
      'fixture-host',
      'broken-independent',
      'routing',
    ])
    expect(kernel.effectiveGraph()).toMatchObject({
      phase: 0,
      packages: [
        expect.objectContaining({
          id: 'voiceclaw-fixture',
          contributions: expect.arrayContaining([
            expect.objectContaining({ id: 'fixture-host', state: 'ACTIVE' }),
            expect.objectContaining({ id: 'routing', state: 'ACTIVE' }),
            expect.objectContaining({ id: 'missing-consumer', state: 'PENDING' }),
            expect.objectContaining({ id: 'broken-independent', state: 'FAILED' }),
            expect.objectContaining({ id: 'invalid-config', state: 'FAILED' }),
          ]),
        }),
      ],
    })
    expect(JSON.stringify(kernel.effectiveGraph())).not.toContain(packageRoot)

    const restoredLoad = vi.fn(loadContribution)
    const restored = await PhaseZeroKernel.bootstrap({
      shippedRoots: [],
      developmentAllowlistedRoots: [packagesRoot],
      voiceclawVersion: '0.1.0',
      controlStatePath: join(directory, 'control-state.json'),
      selectedProviders: {
        'harness.execution': {
          packageId: 'voiceclaw-fixture',
          contributionId: 'fixture-host',
        },
        'provider.status': {
          packageId: 'voiceclaw-fixture',
          contributionId: 'fixture-host',
        },
      },
      configurations: {
        'voiceclaw-fixture:invalid-config': { enabled: 'yes' },
      },
      assignments: [],
      grants: [],
      loadContribution: restoredLoad,
    })
    expect(restoredLoad.mock.calls.map(([input]) => input.contribution.id)).toContain('routing')
    expect(restored.effectiveGraph()).toMatchObject({
      grantSummaries: expect.arrayContaining([
        expect.objectContaining({ principalId: 'voiceclaw-fixture:routing' }),
      ]),
    })

    const envelope = {
      contract: { id: 'harness.execution', version: '1.0.0' },
      operation: 'turn.start',
      invocationId: 'invocation-1',
      principal: { kind: 'contribution', id: 'voiceclaw-fixture:routing' },
      scope: { kind: 'workspace', id: 'workspace-1' },
      selectedContribution: {
        packageId: 'voiceclaw-fixture',
        contributionId: 'fixture-host',
      },
      generation: 1,
      trace: { traceId: 'trace-1' },
      cancellation: { supported: true, token: 'cancel-1' },
    }
    const payload = {
      bindingId: 'binding-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      attemptId: 'attempt-1',
      generation: 1,
      input: { text: 'hello' },
    }

    await expect(
      kernel.invoke(
        { ...envelope, operation: 'provider.describe', invocationId: 'invocation-describe' },
        {},
        {
          authenticatedPrincipal: {
            kind: 'contribution',
            id: 'voiceclaw-fixture:routing',
          },
        }
      )
    ).resolves.toEqual({
      result: { providerId: 'fixture', displayName: 'Fixture provider' },
    })

    await expect(
      kernel.invoke(envelope, payload, {
        authenticatedPrincipal: { kind: 'contribution', id: 'attacker' },
      })
    ).rejects.toThrow('authenticated Principal')
    await expect(
      kernel.invoke(
        { ...envelope, generation: 0 },
        { ...payload, generation: 0 },
        {
          authenticatedPrincipal: {
            kind: 'contribution',
            id: 'voiceclaw-fixture:routing',
          },
        }
      )
    ).rejects.toThrow('stale_generation')
    await expect(
      kernel.invoke(
        envelope,
        { ...payload, input: { text: 'private' } },
        {
          authenticatedPrincipal: {
            kind: 'contribution',
            id: 'voiceclaw-fixture:routing',
          },
        }
      )
    ).rejects.toThrow('private_reasoning_forbidden')

    const result = await kernel.invoke(envelope, payload, {
      authenticatedPrincipal: { kind: 'contribution', id: 'voiceclaw-fixture:routing' },
    })
    expect(result.events).toHaveLength(2)
    expect(result.events.at(-1)).toMatchObject({
      kind: 'terminal',
      payload: { outcome: 'completed' },
    })

    await kernel.disposeContribution({
      packageId: 'voiceclaw-fixture',
      contributionId: 'fixture-host',
    })
    expect(disposeHost).toHaveBeenCalledOnce()
    expect(disposeRouting).toHaveBeenCalledOnce()
    await expect(
      kernel.invoke(envelope, payload, {
        authenticatedPrincipal: { kind: 'contribution', id: 'voiceclaw-fixture:routing' },
      })
    ).rejects.toThrow(/selected provider|not active/)
    expect(kernel.effectiveGraph()).toMatchObject({
      packages: [
        expect.objectContaining({
          contributions: expect.arrayContaining([
            expect.objectContaining({ id: 'fixture-host', state: 'DISPOSED', callable: false }),
            expect.objectContaining({ id: 'routing', state: 'PENDING', callable: false }),
          ]),
        }),
      ],
      selectedProviders: [],
    })
  })
})

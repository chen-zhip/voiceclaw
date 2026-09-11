import { describe, expect, it } from 'vitest'
import * as effectiveGraph from '../../src/plugin-kernel/effective-graph.js'

describe('effective plugin graph', () => {
  it('projects Phase 0 state without paths or secrets', () => {
    const createEffectivePluginGraph = (effectiveGraph as Record<string, unknown>)
      .createEffectivePluginGraph as ((input: Record<string, unknown>) => unknown) | undefined

    expect(typeof createEffectivePluginGraph).toBe('function')
    if (!createEffectivePluginGraph) return

    const graph = createEffectivePluginGraph({
      packages: [
        {
          root: 'C:/Users/private/dev/provider',
          manifest: {
            id: 'voiceclaw-provider-fixture',
            version: '1.0.0',
            feature: { id: 'fixture', displayName: 'Fixture' },
            contributions: [
              {
                id: 'host',
                type: 'provider-integration',
                runtime: 'desktop',
                entry: 'dist/private-host.js',
                provides: [{ id: 'harness.execution', version: '1.0.0' }],
                requires: [],
              },
            ],
          },
        },
        {
          manifest: {
            id: 'voiceclaw-pending-fixture',
            version: '1.0.0',
            feature: { id: 'pending-fixture', displayName: 'Pending fixture' },
            contributions: [
              {
                id: 'host',
                type: 'provider-integration',
                runtime: 'desktop',
                provides: [],
                requires: [{ id: 'archive.read', range: '^1.0.0' }],
              },
            ],
          },
        },
      ],
      lifecycle: [
        {
          packageId: 'voiceclaw-provider-fixture',
          id: 'host',
          state: 'DEGRADED',
          reason: 'Session unavailable',
          callable: true,
          readiness: { process: true, transport: true, session: false },
        },
        {
          packageId: 'voiceclaw-pending-fixture',
          id: 'host',
          state: 'PENDING',
          reason: 'Required Capability provider is unavailable',
          callable: false,
        },
      ],
      selectedProviders: {
        'harness.execution': {
          packageId: 'voiceclaw-provider-fixture',
          contributionId: 'host',
          version: '1.0.0',
        },
      },
      dependencyEdges: [
        {
          provider: 'voiceclaw-provider-fixture:host',
          consumer: 'voiceclaw-pending-fixture:host',
          contractId: 'harness.execution',
        },
      ],
      grants: [
        {
          principalId: 'routing',
          contractId: 'harness.execution',
          operations: ['turn.start'],
          scopeKind: 'workspace',
          secretRefs: ['provider-api-key'],
          workspaceBindings: ['C:/Users/private/workspace'],
        },
      ],
      optionalCapabilities: [
        { id: 'archive.read', range: '^1.0.0', available: false },
        { id: 'memory.read', range: '^1.0.0', available: false },
      ],
    })

    expect(graph).toEqual({
      phase: 0,
      packages: [
        {
          id: 'voiceclaw-provider-fixture',
          version: '1.0.0',
          feature: { id: 'fixture', displayName: 'Fixture' },
          contributions: [
            {
              id: 'host',
              type: 'provider-integration',
              runtime: 'desktop',
              provides: [{ id: 'harness.execution', version: '1.0.0' }],
              requires: [],
              state: 'DEGRADED',
              reason: 'Session unavailable',
              callable: true,
              readiness: { process: true, transport: true, session: false },
            },
          ],
        },
        {
          id: 'voiceclaw-pending-fixture',
          version: '1.0.0',
          feature: { id: 'pending-fixture', displayName: 'Pending fixture' },
          contributions: [
            {
              id: 'host',
              type: 'provider-integration',
              runtime: 'desktop',
              provides: [],
              requires: [{ id: 'archive.read', range: '^1.0.0' }],
              state: 'PENDING',
              reason: 'Required Capability provider is unavailable',
              callable: false,
            },
          ],
        },
      ],
      selectedProviders: [
        {
          contractId: 'harness.execution',
          packageId: 'voiceclaw-provider-fixture',
          contributionId: 'host',
          version: '1.0.0',
        },
      ],
      dependencyEdges: [
        {
          provider: 'voiceclaw-provider-fixture:host',
          consumer: 'voiceclaw-pending-fixture:host',
          contractId: 'harness.execution',
        },
      ],
      grantSummaries: [
        {
          principalId: 'routing',
          contractId: 'harness.execution',
          operations: ['turn.start'],
          scopeKind: 'workspace',
          secretRefCount: 1,
          workspaceBindingCount: 1,
        },
      ],
      optionalCapabilities: [
        { id: 'archive.read', range: '^1.0.0', status: 'absent' },
        { id: 'memory.read', range: '^1.0.0', status: 'absent' },
      ],
    })
    expect(JSON.stringify(graph)).not.toContain('C:/')
    expect(JSON.stringify(graph)).not.toContain('provider-api-key')
    expect(JSON.stringify(graph)).not.toContain('entry')
  })
})

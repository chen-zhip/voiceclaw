import type { ContributionLifecycleProjection } from './contribution-lifecycle.js'
import { contributionKey, type ContributionIdentity } from '@voiceclaw/contracts'

interface EffectiveGraphInput {
  packages: Array<{
    root?: string
    manifest: {
      id: string
      version: string
      feature: { id: string; displayName: string }
      contributions: Array<{
        id: string
        type: string
        runtime: string
        entry?: string
        provides: Array<{ id: string; version: string }>
        requires: Array<{ id: string; range: string }>
      }>
    }
  }>
  lifecycle: ContributionLifecycleProjection[]
  selectedProviders: Record<string, ContributionIdentity & { version: string }>
  dependencyEdges: Array<{ provider: string; consumer: string; contractId: string }>
  grants: Array<{
    principalId: string
    contractId: string
    operations: string[]
    scopeKind: string
    secretRefs?: string[]
    workspaceBindings?: string[]
  }>
  optionalCapabilities: Array<{
    id: string
    range: string
    available: boolean
  }>
}

export function createEffectivePluginGraph(input: EffectiveGraphInput) {
  const lifecycleById = new Map(
    input.lifecycle.map((item) => [contributionKey(item.packageId, item.id), item])
  )
  return {
    phase: 0 as const,
    packages: input.packages.map(({ manifest }) => ({
      id: manifest.id,
      version: manifest.version,
      feature: {
        id: manifest.feature.id,
        displayName: manifest.feature.displayName,
      },
      contributions: manifest.contributions.map((contribution) => {
        const lifecycle = lifecycleById.get(contributionKey(manifest.id, contribution.id))
        return {
          id: contribution.id,
          type: contribution.type,
          runtime: contribution.runtime,
          provides: contribution.provides.map((item) => ({ ...item })),
          requires: contribution.requires.map((item) => ({ ...item })),
          state: lifecycle?.state ?? 'PENDING',
          reason: redactDiagnostic(
            lifecycle?.reason ?? 'Contribution has not reported runtime state'
          ),
          callable: lifecycle?.callable ?? false,
          ...(lifecycle?.readiness ? { readiness: { ...lifecycle.readiness } } : {}),
        }
      }),
    })),
    selectedProviders: Object.entries(input.selectedProviders).map(([contractId, provider]) => ({
      contractId,
      packageId: provider.packageId,
      contributionId: provider.contributionId,
      version: provider.version,
    })),
    dependencyEdges: input.dependencyEdges.map((edge) => ({ ...edge })),
    grantSummaries: input.grants.map((grant) => ({
      principalId: grant.principalId,
      contractId: grant.contractId,
      operations: [...grant.operations],
      scopeKind: grant.scopeKind,
      secretRefCount: grant.secretRefs?.length ?? 0,
      workspaceBindingCount: grant.workspaceBindings?.length ?? 0,
    })),
    optionalCapabilities: input.optionalCapabilities.map((capability) => ({
      id: capability.id,
      range: capability.range,
      status: capability.available ? ('available' as const) : ('absent' as const),
    })),
  }
}

function redactDiagnostic(value: string): string {
  return value
    .replace(/[A-Za-z]:[\\/][^\s,;]+/g, '[redacted-path]')
    .replace(/\/(?:Users|home)\/[^\s,;]+/g, '[redacted-path]')
}

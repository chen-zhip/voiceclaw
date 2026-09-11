import { dirname } from 'node:path'
import { reconcileContributionLifecycle } from './contribution-lifecycle.js'
import { ControlStateStore } from './control-state-store.js'
import { resolveRequiredDependencyGraph } from './dependency-graph.js'
import { createEffectivePluginGraph } from './effective-graph.js'
import { contributionKey } from '@voiceclaw/contracts'

export interface PhaseZeroContribution {
  id: string
  packageId: string
  feature: { id: string; displayName: string }
  version: string
  type: string
  runtime: string
  provides: Array<{ id: string; version: string }>
  requires: Array<{ id: string; range: string }>
  readiness?: { process: boolean; transport: boolean; session: boolean }
}

export async function bootstrapPhaseZeroProfile(input: {
  controlStatePath: string
  contributions: PhaseZeroContribution[]
  optionalCapabilities: Array<{ id: string; range: string }>
}) {
  const dependencyGraph = resolveRequiredDependencyGraph(input.contributions)
  const activeIds = new Set(dependencyGraph.activationOrder)
  const pendingReasons = new Map(
    dependencyGraph.pending.map((item) => [item.contributionId, item.reason])
  )
  const contributions = reconcileContributionLifecycle(
    input.contributions.map((contribution) => ({
      packageId: contribution.packageId,
      id: contribution.id,
      enabled: true,
      requiredDependenciesReady: activeIds.has(
        contributionKey(contribution.packageId, contribution.id)
      ),
      loaded: activeIds.has(contributionKey(contribution.packageId, contribution.id)),
      callable: activeIds.has(contributionKey(contribution.packageId, contribution.id)),
      ...(contribution.readiness ? { readiness: contribution.readiness } : {}),
      ...(pendingReasons.has(contributionKey(contribution.packageId, contribution.id))
        ? { failure: undefined }
        : {}),
    }))
  ).map((projection) => {
    const id = contributionKey(projection.packageId, projection.id)
    return pendingReasons.has(id)
      ? {
          ...projection,
          state: 'PENDING' as const,
          reason: pendingReasons.get(id) as string,
          callable: false,
        }
      : projection
  })

  const packages = groupPackages(input.contributions)
  const selectedProviders: Record<
    string,
    { packageId: string; contributionId: string; version: string }
  > = {}
  for (const edge of dependencyGraph.edges) {
    const provider = input.contributions.find(
      (item) => contributionKey(item.packageId, item.id) === edge.provider
    )
    const contract = provider?.provides.find((item) => item.id === edge.contractId)
    if (provider && contract) {
      selectedProviders[edge.contractId] = {
        packageId: provider.packageId,
        contributionId: provider.id,
        version: contract.version,
      }
    }
  }

  const controlStateStore = await ControlStateStore.open(input.controlStatePath, {
    allowedDirectory: dirname(input.controlStatePath),
    requester: { kind: 'relay-authority', id: 'kernel' },
  })
  const effectiveGraph = createEffectivePluginGraph({
    packages,
    lifecycle: contributions,
    selectedProviders,
    dependencyEdges: dependencyGraph.edges,
    grants: controlStateStore.read().grants.map((grant) => ({
      principalId: grant.principalId,
      contractId: grant.contractId,
      operations: [grant.operation],
      scopeKind: grant.scope.kind,
      secretRefs: grant.secretRefs,
      workspaceBindings: grant.workspaceBindings,
    })),
    optionalCapabilities: input.optionalCapabilities.map((capability) => ({
      ...capability,
      available: false,
    })),
  })

  return {
    activationOrder: dependencyGraph.activationOrder,
    contributions,
    effectiveGraph,
    loadedModuleIds: [...dependencyGraph.activationOrder],
    controlStateStore,
  }
}

function groupPackages(contributions: PhaseZeroContribution[]) {
  const packages = new Map<
    string,
    {
      manifest: {
        id: string
        version: string
        feature: { id: string; displayName: string }
        contributions: Array<{
          id: string
          type: string
          runtime: string
          provides: Array<{ id: string; version: string }>
          requires: Array<{ id: string; range: string }>
        }>
      }
    }
  >()
  for (const contribution of contributions) {
    let pluginPackage = packages.get(contribution.packageId)
    if (!pluginPackage) {
      pluginPackage = {
        manifest: {
          id: contribution.packageId,
          version: contribution.version,
          feature: { ...contribution.feature },
          contributions: [],
        },
      }
      packages.set(contribution.packageId, pluginPackage)
    }
    pluginPackage.manifest.contributions.push({
      id: contribution.id,
      type: contribution.type,
      runtime: contribution.runtime,
      provides: contribution.provides.map((item) => ({ ...item })),
      requires: contribution.requires.map((item) => ({ ...item })),
    })
  }
  return [...packages.values()]
}

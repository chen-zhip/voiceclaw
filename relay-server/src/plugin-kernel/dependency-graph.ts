import { versionSatisfies } from './semver.js'
import { contributionKey, type ContributionIdentity } from '@voiceclaw/contracts'

export { versionSatisfies } from './semver.js'

export interface DependencyContribution {
  packageId: string
  id: string
  provides: Array<{ id: string; version: string }>
  requires: Array<{ id: string; range: string }>
}

export interface DependencyEdge {
  provider: string
  consumer: string
  contractId: string
}

export interface DependencyGraphResult {
  activationOrder: string[]
  edges: DependencyEdge[]
  pending: Array<{ contributionId: string; reason: string }>
  cycles: string[][]
}

export interface DependencyGraphOptions {
  selectedProviders?: Record<string, ContributionIdentity>
  grantSatisfies?: (
    consumer: DependencyContribution,
    requirement: { id: string; range: string }
  ) => boolean
}

export function resolveRequiredDependencyGraph(
  contributions: DependencyContribution[],
  options: DependencyGraphOptions = {}
): DependencyGraphResult {
  const providers = new Map<string, Array<{ contributionId: string; version: string }>>()
  for (const contribution of contributions) {
    const id = contributionKey(contribution.packageId, contribution.id)
    for (const provided of contribution.provides) {
      const choices = providers.get(provided.id) ?? []
      choices.push({ contributionId: id, version: provided.version })
      providers.set(provided.id, choices)
    }
  }

  const edges: DependencyEdge[] = []
  const pendingReasons = new Map<string, string>()
  for (const contribution of contributions) {
    const id = contributionKey(contribution.packageId, contribution.id)
    for (const required of contribution.requires) {
      const selected = options.selectedProviders?.[required.id]
      const provider = providers
        .get(required.id)
        ?.find(
          (choice) =>
            (!selected ||
              choice.contributionId ===
                contributionKey(selected.packageId, selected.contributionId)) &&
            versionSatisfies(choice.version, required.range)
        )
      if (
        !provider ||
        (options.grantSatisfies && !options.grantSatisfies(contribution, required))
      ) {
        pendingReasons.set(
          id,
          `Required Capability ${required.id}@${required.range} or its grant is unavailable`
        )
      } else {
        edges.push({
          provider: provider.contributionId,
          consumer: id,
          contractId: required.id,
        })
      }
    }
  }

  let changed = true
  while (changed) {
    changed = false
    for (const edge of edges) {
      if (pendingReasons.has(edge.provider) && !pendingReasons.has(edge.consumer)) {
        pendingReasons.set(edge.consumer, `Required provider ${edge.provider} is pending`)
        changed = true
      }
    }
  }

  const eligibleIds = contributions
    .map((item) => contributionKey(item.packageId, item.id))
    .filter((id) => !pendingReasons.has(id))
  const eligible = new Set(eligibleIds)
  const cycles = findCycles(
    eligibleIds,
    edges.filter((edge) => eligible.has(edge.provider) && eligible.has(edge.consumer))
  )
  const cycleMembers = new Set(cycles.flat())
  for (const id of cycleMembers) {
    pendingReasons.set(id, `Required Capability dependency cycle includes ${id}`)
  }

  changed = true
  while (changed) {
    changed = false
    for (const edge of edges) {
      if (pendingReasons.has(edge.provider) && !pendingReasons.has(edge.consumer)) {
        pendingReasons.set(edge.consumer, `Required provider ${edge.provider} is pending`)
        changed = true
      }
    }
  }

  const activeIds = eligibleIds.filter((id) => !pendingReasons.has(id))
  const active = new Set(activeIds)
  const indegree = new Map(activeIds.map((id) => [id, 0]))
  const outgoing = new Map(activeIds.map((id) => [id, [] as string[]]))
  for (const edge of edges) {
    if (!active.has(edge.provider) || !active.has(edge.consumer)) continue
    indegree.set(edge.consumer, (indegree.get(edge.consumer) ?? 0) + 1)
    outgoing.get(edge.provider)?.push(edge.consumer)
  }

  const queue = activeIds.filter((id) => indegree.get(id) === 0)
  const activationOrder: string[] = []
  while (queue.length > 0) {
    const id = queue.shift() as string
    activationOrder.push(id)
    for (const consumer of outgoing.get(id) ?? []) {
      const next = (indegree.get(consumer) ?? 0) - 1
      indegree.set(consumer, next)
      if (next === 0) queue.push(consumer)
    }
  }

  return {
    activationOrder,
    edges,
    pending: contributions
      .filter((item) => pendingReasons.has(contributionKey(item.packageId, item.id)))
      .map((item) => ({
        contributionId: contributionKey(item.packageId, item.id),
        reason: pendingReasons.get(contributionKey(item.packageId, item.id)) as string,
      })),
    cycles,
  }
}

function findCycles(ids: string[], edges: DependencyEdge[]): string[][] {
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]))
  for (const edge of edges) outgoing.get(edge.provider)?.push(edge.consumer)
  const complete = new Set<string>()
  const visiting = new Set<string>()
  const path: string[] = []
  const cycles: string[][] = []

  const visit = (id: string) => {
    if (complete.has(id)) return
    if (visiting.has(id)) {
      const start = path.indexOf(id)
      const cycle = [...path.slice(start), id]
      if (!cycles.some((existing) => sameCycle(existing, cycle))) cycles.push(cycle)
      return
    }
    visiting.add(id)
    path.push(id)
    for (const consumer of outgoing.get(id) ?? []) visit(consumer)
    path.pop()
    visiting.delete(id)
    complete.add(id)
  }

  for (const id of ids) visit(id)
  return cycles
}

function sameCycle(left: string[], right: string[]): boolean {
  const leftMembers = [...new Set(left)].sort()
  const rightMembers = [...new Set(right)].sort()
  return (
    leftMembers.length === rightMembers.length &&
    leftMembers.every((item, index) => item === rightMembers[index])
  )
}

export type ContributionState =
  | 'PENDING'
  | 'LOADING'
  | 'ACTIVE'
  | 'DEGRADED'
  | 'FAILED'
  | 'DISPOSED'

export interface OperationalReadiness {
  process: boolean
  transport: boolean
  session: boolean
}

export interface ContributionLifecycleInput {
  packageId: string
  id: string
  enabled: boolean
  requiredDependenciesReady: boolean
  loaded: boolean
  callable: boolean
  readiness?: OperationalReadiness
  failure?: string
}

export interface ContributionLifecycleProjection {
  packageId: string
  id: string
  state: ContributionState
  reason: string
  callable: boolean
  readiness?: OperationalReadiness
}

export function reconcileContributionLifecycle(
  inputs: ContributionLifecycleInput[]
): ContributionLifecycleProjection[] {
  return inputs.map((input) => {
    const base = {
      packageId: input.packageId,
      id: input.id,
      callable: input.callable,
      ...(input.readiness ? { readiness: { ...input.readiness } } : {}),
    }
    if (!input.enabled) {
      return { ...base, state: 'DISPOSED' as const, reason: 'Contribution is disabled or disposed' }
    }
    if (input.failure) {
      return { ...base, state: 'FAILED' as const, reason: input.failure }
    }
    if (!input.requiredDependenciesReady) {
      return {
        ...base,
        state: 'PENDING' as const,
        reason: 'Required Capability provider is unavailable',
      }
    }
    if (!input.loaded || !input.callable) {
      return { ...base, state: 'LOADING' as const, reason: 'Contribution is loading' }
    }
    if (input.readiness) {
      const unavailable = Object.entries(input.readiness)
        .filter(([, ready]) => !ready)
        .map(([name]) => name)
      if (unavailable.length > 0) {
        return {
          ...base,
          state: 'DEGRADED' as const,
          reason: `Operational readiness unavailable: ${unavailable.join(', ')}`,
        }
      }
    }
    return { ...base, state: 'ACTIVE' as const, reason: 'Contribution is loaded and callable' }
  })
}

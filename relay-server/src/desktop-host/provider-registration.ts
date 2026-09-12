import { contributionKey, hasExactKeys, isNonemptyString, isRecord } from '@voiceclaw/contracts'

type HostPrincipal = { kind: 'desktop-host'; id: string }

type ContractReference = { id: string; version: string }

export type HostContributionRegistration = {
  packageId: string
  contributionId: string
  category: 'provider-integration' | 'client-ui'
  providerId: string
  harnessVersion: string
  capabilityProfileVersion: string
  provides: ContractReference[]
  requires: ContractReference[]
  state: 'ACTIVE' | 'DEGRADED'
}

export type ProviderReadiness = {
  executable: 'detected' | 'missing'
  process: 'starting' | 'running' | 'stopped' | 'failed'
  transport: 'disconnected' | 'ready'
  session: 'unavailable' | 'ready'
}

type RegisteredContribution = HostContributionRegistration & {
  hostId: string
  readiness: ProviderReadiness | null
  granted: boolean
}

export class HostContributionRegistrationError extends Error {
  constructor(
    readonly code: 'invalid_host_registration' | 'host_contribution_not_found',
    message: string
  ) {
    super(message)
    this.name = 'HostContributionRegistrationError'
  }
}

export class HostContributionRegistry {
  readonly #registrations = new Map<string, RegisteredContribution>()

  constructor(private readonly connections?: { isConnected(hostId: string): boolean }) {}

  register(principal: HostPrincipal, input: HostContributionRegistration): void {
    if (principal.kind !== 'desktop-host' || !isRegistration(input)) {
      throw new HostContributionRegistrationError(
        'invalid_host_registration',
        'Host Contribution registration is invalid'
      )
    }
    const key = hostContributionKey(principal.id, input.packageId, input.contributionId)
    this.#registrations.set(key, {
      ...structuredClone(input),
      hostId: principal.id,
      readiness: null,
      granted: false,
    })
  }

  loadFromKernel(
    principal: HostPrincipal,
    kernel: { effectiveGraph(): KernelGraph },
    providerIds: Record<string, string>,
    readiness: Record<string, ProviderReadiness>
  ): void {
    if (principal.kind !== 'desktop-host' || !this.connections?.isConnected(principal.id)) {
      throw new HostContributionRegistrationError(
        'invalid_host_registration',
        'Kernel Contributions require an authenticated Desktop Host'
      )
    }
    const graph = kernel.effectiveGraph()
    for (const pluginPackage of graph.packages) {
      for (const contribution of pluginPackage.contributions) {
        if (
          (contribution.type !== 'provider-integration' && contribution.type !== 'client-ui') ||
          contribution.state !== 'ACTIVE'
        ) {
          continue
        }
        const identity = `${pluginPackage.id}:${contribution.id}`
        const harnessVersion =
          contribution.provides.find((contract) => contract.id === 'harness.execution')?.version ??
          '1.0.0'
        const capabilityProfileVersion =
          contribution.provides.find((contract) => contract.id === 'harness.capability-profile')
            ?.version ?? '1.0.0'
        this.register(principal, {
          packageId: pluginPackage.id,
          contributionId: contribution.id,
          category: contribution.type,
          providerId: providerIds[identity] ?? pluginPackage.feature.id,
          harnessVersion,
          capabilityProfileVersion,
          provides: contribution.provides,
          requires: contribution.requires.map((contract) => ({
            id: contract.id,
            version: contract.range,
          })),
          state: 'ACTIVE',
        })
        const registered = this.#registrations.get(
          hostContributionKey(principal.id, pluginPackage.id, contribution.id)
        ) as RegisteredContribution
        registered.granted = contribution.provides.some((provided) =>
          graph.grantSummaries.some((grant) => grant.contractId === provided.id)
        )
        if (contribution.type === 'provider-integration' && readiness[identity]) {
          registered.readiness = structuredClone(readiness[identity])
        }
      }
    }
  }

  reportReadiness(
    principal: HostPrincipal,
    contributionIdentity: string,
    readiness: ProviderReadiness
  ): void {
    const registration = this.#registrations.get(`${principal.id}:${contributionIdentity}`)
    if (
      principal.kind !== 'desktop-host' ||
      !registration ||
      registration.category !== 'provider-integration' ||
      !isReadiness(readiness)
    ) {
      throw new HostContributionRegistrationError(
        'host_contribution_not_found',
        'Provider Contribution registration is unavailable'
      )
    }
    registration.readiness = structuredClone(readiness)
  }

  projectHost(hostId: string) {
    return [...this.#registrations.values()]
      .filter((registration) => registration.hostId === hostId)
      .map(({ hostId: _, ...registration }) => ({
        ...structuredClone(registration),
        state:
          registration.category === 'provider-integration' &&
          registration.readiness?.session !== 'ready'
            ? ('DEGRADED' as const)
            : registration.state,
        callable: registration.state === 'ACTIVE' || registration.state === 'DEGRADED',
      }))
  }

  isCallable(input: {
    hostId: string
    packageId: string
    contributionId: string
    providerId: string
  }): boolean {
    const registration = this.#registrations.get(
      hostContributionKey(input.hostId, input.packageId, input.contributionId)
    )
    return Boolean(
      registration &&
      registration.category === 'provider-integration' &&
      registration.providerId === input.providerId &&
      registration.granted &&
      registration.state === 'ACTIVE'
    )
  }
}

export type KernelGraph = {
  packages: Array<{
    id: string
    feature: { id: string }
    contributions: Array<{
      id: string
      type: string
      state: string
      provides: ContractReference[]
      requires: Array<{ id: string; range: string }>
    }>
  }>
  grantSummaries: Array<{ principalId: string; contractId: string }>
}

const registrationKeys = [
  'packageId',
  'contributionId',
  'category',
  'providerId',
  'harnessVersion',
  'capabilityProfileVersion',
  'provides',
  'requires',
  'state',
]

function isRegistration(value: unknown): value is HostContributionRegistration {
  if (!isRecord(value) || !hasExactKeys(value, registrationKeys)) return false
  return (
    [
      'packageId',
      'contributionId',
      'providerId',
      'harnessVersion',
      'capabilityProfileVersion',
    ].every((key) => isNonemptyString(value[key])) &&
    (value.category === 'provider-integration' || value.category === 'client-ui') &&
    (value.state === 'ACTIVE' || value.state === 'DEGRADED') &&
    Array.isArray(value.provides) &&
    value.provides.every(isContractReference) &&
    Array.isArray(value.requires) &&
    value.requires.every(isContractReference)
  )
}

function isContractReference(value: unknown): value is ContractReference {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['id', 'version']) &&
    isNonemptyString(value.id) &&
    isNonemptyString(value.version)
  )
}

function isReadiness(value: unknown): value is ProviderReadiness {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['executable', 'process', 'transport', 'session']) &&
    (value.executable === 'detected' || value.executable === 'missing') &&
    ['starting', 'running', 'stopped', 'failed'].includes(value.process as string) &&
    (value.transport === 'disconnected' || value.transport === 'ready') &&
    (value.session === 'unavailable' || value.session === 'ready')
  )
}

function hostContributionKey(hostId: string, packageId: string, contributionId: string): string {
  return `${hostId}:${contributionKey(packageId, contributionId)}`
}

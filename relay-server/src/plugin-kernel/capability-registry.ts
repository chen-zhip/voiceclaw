import { versionSatisfies } from './semver.js'
import type { ContributionIdentity } from '@voiceclaw/contracts'

export interface CapabilityProvider extends ContributionIdentity {
  contract: { id: string; version: string }
  active?: boolean
  invoke(operation: string, payload: unknown): Promise<unknown>
}

export interface CapabilityProfile {
  selectedProviders: Record<string, ContributionIdentity>
}

export type CapabilityInvocationResult =
  | { success: true; value: unknown; packageId: string; contributionId: string }
  | {
      success: false
      error: { code: 'provider_failure'; message: string }
      packageId: string
      contributionId: string
    }

export type CapabilityLookup =
  | { available: false; reason: string }
  | {
      available: true
      packageId: string
      contributionId: string
      version: string
      invoke(operation: string, payload: unknown): Promise<CapabilityInvocationResult>
    }

export class CapabilityRegistry {
  readonly #profile: CapabilityProfile
  readonly #providers = new Map<string, CapabilityProvider[]>()

  constructor(profile: CapabilityProfile) {
    this.#profile = structuredClone(profile)
  }

  register(provider: CapabilityProvider): void {
    const providers = this.#providers.get(provider.contract.id) ?? []
    if (
      providers.some(
        (item) =>
          item.packageId === provider.packageId &&
          item.contributionId === provider.contributionId &&
          item.contract.version === provider.contract.version
      )
    ) {
      throw new Error('Capability provider is already registered')
    }
    providers.push(provider)
    this.#providers.set(provider.contract.id, providers)
  }

  resolveRequired(requirement: { id: string; range: string }): CapabilityLookup {
    return this.#lookup(requirement)
  }

  lookupOptional(requirement: { id: string; range: string }): CapabilityLookup {
    return this.#lookup(requirement)
  }

  #lookup(requirement: { id: string; range: string }): CapabilityLookup {
    const selected = this.#profile.selectedProviders[requirement.id]
    const provider = this.#providers
      .get(requirement.id)
      ?.find(
        (candidate) =>
          candidate.packageId === selected?.packageId &&
          candidate.contributionId === selected?.contributionId &&
          candidate.active !== false &&
          versionSatisfies(candidate.contract.version, requirement.range)
      )

    if (!provider) {
      return {
        available: false,
        reason: `No selected compatible provider for ${requirement.id}@${requirement.range}`,
      }
    }

    return {
      available: true,
      packageId: provider.packageId,
      contributionId: provider.contributionId,
      version: provider.contract.version,
      invoke: async (operation, payload) => {
        try {
          return {
            success: true,
            value: await provider.invoke(operation, payload),
            packageId: provider.packageId,
            contributionId: provider.contributionId,
          }
        } catch {
          return {
            success: false,
            error: {
              code: 'provider_failure',
              message: 'Selected Capability provider failed',
            },
            packageId: provider.packageId,
            contributionId: provider.contributionId,
          }
        }
      },
    }
  }
}

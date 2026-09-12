import { contributionKey, type KernelInvocationEnvelope } from '@voiceclaw/contracts'

export interface DesktopHostContribution {
  packageId: string
  contributionId: string
  registration: {
    category: 'provider-integration' | 'client-ui'
    providerId: string
    harnessVersion: string
    capabilityProfileVersion: string
    provides: Array<{ id: string; version: string }>
    requires: Array<{ id: string; version: string }>
    state: 'ACTIVE' | 'DEGRADED'
    readiness: {
      executable: 'detected' | 'missing'
      process: 'starting' | 'running' | 'stopped' | 'failed'
      transport: 'disconnected' | 'ready'
      session: 'unavailable' | 'ready'
    } | null
  }
  invoke(input: {
    envelope: KernelInvocationEnvelope
    payload: Record<string, unknown>
  }): Promise<unknown>
  dispose?(): Promise<void>
}

export class DesktopHostContributionRuntime {
  readonly #loaded = new Map<string, DesktopHostContribution>()

  constructor(private readonly loadEnabled: () => Promise<DesktopHostContribution[]>) {}

  async load(): Promise<void> {
    const contributions = await this.loadEnabled()
    const loaded = new Map<string, DesktopHostContribution>()
    for (const contribution of contributions) {
      const key = contributionKey(contribution.packageId, contribution.contributionId)
      if (loaded.has(key)) throw new Error('duplicate_host_contribution')
      loaded.set(key, contribution)
    }
    this.#loaded.clear()
    for (const [key, contribution] of loaded) this.#loaded.set(key, contribution)
  }

  async invoke(input: {
    envelope: KernelInvocationEnvelope
    payload: Record<string, unknown>
  }): Promise<unknown> {
    const selected = input.envelope.selectedContribution
    const contribution = this.#loaded.get(
      contributionKey(selected.packageId, selected.contributionId)
    )
    if (!contribution) throw new Error('host_contribution_not_loaded')
    return contribution.invoke(input)
  }

  registrations() {
    return [...this.#loaded.values()].map((contribution) => ({
      packageId: contribution.packageId,
      contributionId: contribution.contributionId,
      ...structuredClone(contribution.registration),
    }))
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.#loaded.values()].map((contribution) => contribution.dispose?.()))
    this.#loaded.clear()
  }
}

export type HarnessPipeline = 'stt-tts-harness' | 's2s-direct' | 's2s-operator'
export type HarnessReadiness = 'selection-required' | 'ready' | 'unavailable'

export interface HarnessBindingProjection {
  bindingId: string
  providerId: string
  workspaceBindingId: string
  generation: number
}

export interface OptionalFeatureProjection {
  availability: 'absent' | 'degraded'
  persistence?: 'session-only'
  reason?: string
}

export interface HarnessSelectionSnapshot {
  pipeline: HarnessPipeline
  providerId: string | null
  workspaceBindingId: string | null
  readiness: HarnessReadiness
  binding?: HarnessBindingProjection
  optionalFeatures: Record<string, OptionalFeatureProjection>
  recovery: string[]
}

export class STTTTSHarnessSelection {
  #pipeline: HarnessPipeline = 's2s-direct'
  #providerId: string | null = null
  #workspaceBindingId: string | null = null
  #readiness: HarnessReadiness = 'selection-required'
  #binding: HarnessBindingProjection | undefined
  #optionalFeatures: Record<string, OptionalFeatureProjection> = {}
  #recovery: string[] = []

  selectPipeline(pipeline: HarnessPipeline): void {
    this.#pipeline = pipeline
    if (pipeline === 'stt-tts-harness' && (!this.#providerId || !this.#workspaceBindingId)) {
      this.#readiness = 'selection-required'
    }
  }

  selectProvider(providerId: string): void {
    this.#providerId = providerId
    this.#recalculateReadiness()
  }

  selectWorkspace(workspaceBindingId: string): void {
    this.#workspaceBindingId = workspaceBindingId
    this.#recalculateReadiness()
  }

  projectReadiness(projection: HarnessBindingProjection & { status: 'ready' | 'offline' }): void {
    this.#binding = {
      bindingId: projection.bindingId,
      providerId: projection.providerId,
      workspaceBindingId: projection.workspaceBindingId,
      generation: projection.generation,
    }
    const matches =
      projection.providerId === this.#providerId &&
      projection.workspaceBindingId === this.#workspaceBindingId
    this.#readiness = projection.status === 'ready' && matches ? 'ready' : 'unavailable'
    this.#recovery =
      this.#readiness === 'ready' ? [] : ['retry', 'reselect-provider', 'return-to-s2s']
  }

  projectOptionalFeature(name: string, projection: OptionalFeatureProjection): void {
    this.#optionalFeatures[name] = structuredClone(projection)
  }

  snapshot(): HarnessSelectionSnapshot {
    return {
      pipeline: this.#pipeline,
      providerId: this.#providerId,
      workspaceBindingId: this.#workspaceBindingId,
      readiness: this.#readiness,
      ...(this.#binding ? { binding: structuredClone(this.#binding) } : {}),
      optionalFeatures: structuredClone(this.#optionalFeatures),
      recovery: [...this.#recovery],
    }
  }

  #recalculateReadiness(): void {
    if (!this.#providerId || !this.#workspaceBindingId) {
      this.#readiness = 'selection-required'
      this.#recovery = []
      return
    }
    if (this.#binding) {
      const matches =
        this.#binding.providerId === this.#providerId &&
        this.#binding.workspaceBindingId === this.#workspaceBindingId
      this.#readiness = matches ? 'ready' : 'unavailable'
      this.#recovery =
        this.#readiness === 'ready' ? [] : ['retry', 'reselect-provider', 'return-to-s2s']
    }
  }
}

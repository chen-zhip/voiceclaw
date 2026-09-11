import {
  parseHarnessExecutionRequest,
  parseHarnessExecutionResult,
  parseHarnessExecutionStream,
  parseKernelInvocationEnvelope,
  contributionKey,
  type ContributionIdentity,
  type HarnessExecutionEvent,
  type KernelInvocationEnvelope,
  type PluginContributionManifest,
  type PluginManifestV0,
} from '@voiceclaw/contracts'
import { CapabilityGrantEvaluator } from './capability-grants.js'
import {
  ControlStateStore,
  type ActiveHostAssignmentRecord,
  type CapabilityGrantRecord,
} from './control-state-store.js'
import { createEffectivePluginGraph } from './effective-graph.js'
import { GenerationStreamFence } from './generation-fence.js'
import { startHostRpcInvocation } from './host-rpc.js'
import { discoverPluginPackages } from './package-discovery.js'
import { validateHostRpcOutput } from './private-reasoning-boundary.js'
import { resolveRequiredDependencyGraph } from './dependency-graph.js'
import { validateConfiguration } from './configuration.js'

type SelectedProviderRef = ContributionIdentity

interface LoadedContribution {
  invoke(request: { envelope: KernelInvocationEnvelope; payload: unknown }): Promise<unknown>
  dispose?(): Promise<void>
}

interface LoadedEntry {
  manifest: PluginManifestV0
  contribution: PluginContributionManifest
  loaded: LoadedContribution
}

export class PhaseZeroKernel {
  readonly #entries: Map<string, LoadedEntry>
  readonly #selectedProviders: Record<string, SelectedProviderRef>
  readonly #grants: CapabilityGrantEvaluator
  readonly #store: ControlStateStore
  readonly #graph: ReturnType<typeof createEffectivePluginGraph>

  private constructor(
    entries: Map<string, LoadedEntry>,
    selectedProviders: Record<string, SelectedProviderRef>,
    grants: CapabilityGrantEvaluator,
    store: ControlStateStore,
    graph: ReturnType<typeof createEffectivePluginGraph>
  ) {
    this.#entries = entries
    this.#selectedProviders = selectedProviders
    this.#grants = grants
    this.#store = store
    this.#graph = graph
  }

  static async bootstrap(options: {
    shippedRoots: string[]
    developmentAllowlistedRoots: string[]
    voiceclawVersion: string
    controlStatePath: string
    selectedProviders: Record<string, SelectedProviderRef>
    configurations: Record<string, unknown>
    grants: CapabilityGrantRecord[]
    assignments: ActiveHostAssignmentRecord[]
    loadContribution(input: {
      packageRoot: string
      manifest: PluginManifestV0
      contribution: PluginContributionManifest
    }): Promise<LoadedContribution>
  }): Promise<PhaseZeroKernel> {
    const discovery = await discoverPluginPackages(options)
    if (discovery.packages.length === 0) {
      throw new Error('Phase 0 Profile has no accepted plugin package')
    }

    const store = await ControlStateStore.open(options.controlStatePath, {
      requester: { kind: 'relay-authority', id: 'phase-zero-kernel' },
    })
    if (options.grants.length > 0 || options.assignments.length > 0) {
      await store.commit((state) => ({
        ...state,
        grants: options.grants.length > 0 ? options.grants : state.grants,
        assignments: options.assignments.length > 0 ? options.assignments : state.assignments,
      }))
    }
    const effectiveGrants = store.read().grants

    const candidates = discovery.packages.flatMap((pluginPackage) =>
      pluginPackage.manifest.contributions.map((contribution) => ({
        packageRoot: pluginPackage.root,
        manifest: pluginPackage.manifest,
        contribution,
      }))
    )
    const dependencyGraph = resolveRequiredDependencyGraph(
      candidates.map(({ manifest, contribution }) => ({
        packageId: manifest.id,
        id: contribution.id,
        provides: contribution.provides,
        requires: contribution.requires,
      })),
      {
        selectedProviders: options.selectedProviders,
        grantSatisfies: (consumer, requirement) =>
          effectiveGrants.some(
            (grant) =>
              !grant.revoked &&
              grant.principalId === contributionKey(consumer.packageId, consumer.id) &&
              grant.contractId === requirement.id
          ),
      }
    )
    const entries = new Map<string, LoadedEntry>()
    const activationFailures = new Map<string, string>()
    const runtimePending = new Set<string>()
    for (const key of dependencyGraph.activationOrder) {
      const candidate = candidates.find(
        ({ manifest, contribution }) => contributionKey(manifest.id, contribution.id) === key
      )
      if (!candidate) continue
      const configuration = options.configurations[key] ?? {}
      if (validateConfiguration(candidate.contribution.configSchema, configuration).length > 0) {
        activationFailures.set(key, 'Contribution configuration is invalid')
        continue
      }
      if (
        dependencyGraph.edges.some((edge) => edge.consumer === key && !entries.has(edge.provider))
      ) {
        runtimePending.add(key)
        continue
      }
      try {
        const loaded = await options.loadContribution(candidate)
        entries.set(key, {
          manifest: candidate.manifest,
          contribution: candidate.contribution,
          loaded,
        })
      } catch {
        activationFailures.set(key, 'Contribution entry failed to load')
      }
    }
    const grants = new CapabilityGrantEvaluator(store)
    const pendingReasons = new Map(
      dependencyGraph.pending.map((item) => [item.contributionId, item.reason])
    )
    const lifecycle = candidates.map(({ manifest, contribution }) => {
      const key = contributionKey(manifest.id, contribution.id)
      return {
        packageId: manifest.id,
        id: contribution.id,
        state: activationFailures.has(key)
          ? ('FAILED' as const)
          : entries.has(key)
            ? ('ACTIVE' as const)
            : ('PENDING' as const),
        reason: activationFailures.has(key)
          ? (activationFailures.get(key) as string)
          : entries.has(key)
            ? 'Contribution is loaded and callable'
            : (pendingReasons.get(key) ??
              (runtimePending.has(key)
                ? 'Required provider failed to activate'
                : 'Contribution is not active')),
        callable: entries.has(key),
      }
    })
    const selectedProviders: Record<
      string,
      { packageId: string; contributionId: string; version: string }
    > = {}
    for (const [contractId, selected] of Object.entries(options.selectedProviders)) {
      const entry = entries.get(contributionKey(selected.packageId, selected.contributionId))
      const provided = entry?.contribution.provides.find(
        (capability) => capability.id === contractId
      )
      if (entry && provided) {
        selectedProviders[contractId] = {
          packageId: selected.packageId,
          contributionId: selected.contributionId,
          version: provided.version,
        }
      }
    }
    const graph = createEffectivePluginGraph({
      packages: discovery.packages,
      lifecycle,
      selectedProviders,
      dependencyEdges: dependencyGraph.edges,
      grants: effectiveGrants.map((grant) => ({
        principalId: grant.principalId,
        contractId: grant.contractId,
        operations: [grant.operation],
        scopeKind: grant.scope.kind,
        secretRefs: grant.secretRefs,
        workspaceBindings: grant.workspaceBindings,
      })),
      optionalCapabilities: [],
    })
    return new PhaseZeroKernel(
      entries,
      structuredClone(options.selectedProviders),
      grants,
      store,
      graph
    )
  }

  effectiveGraph() {
    return structuredClone(this.#graph)
  }

  async invoke(
    envelopeInput: unknown,
    payload: unknown,
    context: {
      authenticatedPrincipal: KernelInvocationEnvelope['principal']
    }
  ): Promise<
    | {
        events: HarnessExecutionEvent[]
      }
    | {
        result: Record<string, unknown>
      }
  > {
    const parsedEnvelope = parseKernelInvocationEnvelope(envelopeInput)
    if (!parsedEnvelope.success) throw new Error('Invalid Kernel Invocation Envelope')
    const envelope = parsedEnvelope.data
    if (
      context.authenticatedPrincipal.kind !== envelope.principal.kind ||
      context.authenticatedPrincipal.id !== envelope.principal.id
    ) {
      throw new Error('Kernel Invocation Envelope does not match the authenticated Principal')
    }
    if (
      this.#selectedProviders[envelope.contract.id]?.packageId !==
        envelope.selectedContribution.packageId ||
      this.#selectedProviders[envelope.contract.id]?.contributionId !==
        envelope.selectedContribution.contributionId
    ) {
      throw new Error('Kernel Invocation Envelope does not name the selected provider')
    }
    const entry = this.#entries.get(
      contributionKey(
        envelope.selectedContribution.packageId,
        envelope.selectedContribution.contributionId
      )
    )
    if (!entry) throw new Error('Selected Contribution is not active')
    if (
      !entry.contribution.provides.some(
        (provided) =>
          provided.id === envelope.contract.id && provided.version === envelope.contract.version
      )
    ) {
      throw new Error('Selected Contribution does not provide the contract version')
    }
    const request = parseHarnessExecutionRequest({
      operation: envelope.operation,
      payload,
    })
    if (!request.success) throw new Error('Invalid harness.execution request')
    const bindingId = request.data.payload.bindingId
    if (typeof bindingId === 'string') {
      const assignment = this.#store
        .read()
        .assignments.find((candidate) => candidate.bindingId === bindingId)
      if (
        !assignment ||
        assignment.hostId !==
          contributionKey(
            envelope.selectedContribution.packageId,
            envelope.selectedContribution.contributionId
          ) ||
        assignment.generation !== envelope.generation ||
        (typeof request.data.payload.generation === 'number' &&
          assignment.generation !== request.data.payload.generation)
      ) {
        throw new Error('stale_generation')
      }
    }

    let hostResult: unknown
    await startHostRpcInvocation({
      envelope,
      payload,
      authorize: (candidate) =>
        this.#grants.authorize({
          principalId: candidate.principal.id,
          contractId: candidate.contract.id,
          operation: candidate.operation,
          scope: candidate.scope,
          ...(candidate.scope.kind === 'workspace' && candidate.scope.id
            ? { workspaceBindingId: candidate.scope.id }
            : {}),
        }).authorized,
      dispatch: async () => {
        hostResult = await entry.loaded.invoke({ envelope, payload })
      },
    })

    if (envelope.operation !== 'turn.start') {
      const result = parseHarnessExecutionResult(envelope.operation, hostResult)
      if (!result.success) throw new Error('Desktop Host returned an invalid Harness result')
      const output = validateHostRpcOutput({ class: 'semantic-output', content: result.data })
      if (!output.accepted) throw new Error(output.code)
      return { result: result.data }
    }

    const stream = parseHarnessExecutionStream(hostResult)
    if (!stream.success) throw new Error('Desktop Host returned an invalid Harness stream')
    const fence = new GenerationStreamFence(envelope.generation)
    for (const event of stream.data) {
      if (event.invocationId !== envelope.invocationId) {
        throw new Error('Harness stream invocation correlation is invalid')
      }
      if (event.kind !== 'terminal') {
        const output = validateHostRpcOutput({ class: event.kind, content: event.payload })
        if (!output.accepted) throw new Error(output.code)
      }
      const accepted = fence.accept(event)
      if (!accepted.accepted) throw new Error(accepted.code)
    }
    return { events: stream.data }
  }

  async disposeContribution(identity: SelectedProviderRef): Promise<void> {
    const disposedKey = contributionKey(identity.packageId, identity.contributionId)
    if (!this.#entries.has(disposedKey)) return
    const affected = new Set([disposedKey])
    let changed = true
    while (changed) {
      changed = false
      for (const edge of this.#graph.dependencyEdges) {
        if (affected.has(edge.provider) && !affected.has(edge.consumer)) {
          affected.add(edge.consumer)
          changed = true
        }
      }
    }

    const disposals: Array<Promise<void>> = []
    for (const key of affected) {
      const entry = this.#entries.get(key)
      if (entry) {
        this.#entries.delete(key)
        if (entry.loaded.dispose) disposals.push(entry.loaded.dispose())
      }
      for (const pluginPackage of this.#graph.packages) {
        for (const contribution of pluginPackage.contributions) {
          if (contributionKey(pluginPackage.id, contribution.id) !== key) continue
          contribution.state = key === disposedKey ? 'DISPOSED' : 'PENDING'
          contribution.reason =
            key === disposedKey
              ? 'Contribution is disabled or disposed'
              : `Required provider ${disposedKey} is pending`
          contribution.callable = false
        }
      }
    }

    for (const [contractId, selected] of Object.entries(this.#selectedProviders)) {
      if (affected.has(contributionKey(selected.packageId, selected.contributionId))) {
        delete this.#selectedProviders[contractId]
      }
    }
    for (let index = this.#graph.selectedProviders.length - 1; index >= 0; index -= 1) {
      const selected = this.#graph.selectedProviders[index]
      if (affected.has(contributionKey(selected.packageId, selected.contributionId))) {
        this.#graph.selectedProviders.splice(index, 1)
      }
    }
    await Promise.all(disposals)
  }
}

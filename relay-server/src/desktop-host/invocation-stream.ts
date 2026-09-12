import {
  isProviderNeutralValue,
  parseHarnessExecutionRequest,
  parseHarnessExecutionResult,
  parseHarnessExecutionStream,
  parseKernelInvocationEnvelope,
  type KernelInvocationEnvelope,
  HARNESS_EXECUTION_CONTRACT,
} from '@voiceclaw/contracts'
import {
  GenerationStreamFence,
  type StreamFenceRejectionCode,
} from '../plugin-kernel/generation-fence.js'

type ContributionIdentity = {
  packageId: string
  contributionId: string
}

export class HarnessExecutionConnectionError extends Error {
  constructor(
    readonly code:
      | 'invalid_host_request'
      | 'invalid_host_output'
      | 'host_contribution_mismatch'
      | 'host_authentication_required'
      | 'operation_unauthorized'
      | 'cancellation_unauthorized'
      | 'cancellation_mismatch'
      | StreamFenceRejectionCode,
    message: string
  ) {
    super(message)
    this.name = 'HarnessExecutionConnectionError'
  }
}

export class HarnessExecutionHostConnection {
  readonly #hostId: string
  readonly #contribution: ContributionIdentity
  readonly #providerId: string
  readonly #invokeContribution: (request: {
    operation: string
    payload: Record<string, unknown>
    envelope: KernelInvocationEnvelope
  }) => Promise<unknown>
  readonly #authorize: (envelope: KernelInvocationEnvelope) => boolean
  readonly #isHostAuthorized: () => boolean
  readonly #readCurrentAssignment: () =>
    | {
        bindingId: string
        hostId: string
        providerId: string
        workspaceBindingId: string
        generation: number
      }
    | undefined
  readonly #activeTurns = new Map<string, { principalId: string; invocationId: string }>()

  constructor(options: {
    authenticatedHost: { kind: 'desktop-host'; id: string }
    contribution: ContributionIdentity
    providerId: string
    authorize: (envelope: KernelInvocationEnvelope) => boolean
    isHostAuthorized: () => boolean
    readCurrentAssignment: () =>
      | {
          bindingId: string
          hostId: string
          providerId: string
          workspaceBindingId: string
          generation: number
        }
      | undefined
    invokeContribution(request: {
      operation: string
      payload: Record<string, unknown>
      envelope: KernelInvocationEnvelope
    }): Promise<unknown>
  }) {
    if (options.authenticatedHost.kind !== 'desktop-host') {
      throw new HarnessExecutionConnectionError(
        'host_authentication_required',
        'Harness execution requires an authenticated Desktop Host connection'
      )
    }
    this.#hostId = options.authenticatedHost.id
    this.#contribution = structuredClone(options.contribution)
    this.#providerId = options.providerId
    this.#invokeContribution = options.invokeContribution
    this.#authorize = options.authorize
    this.#isHostAuthorized = options.isHostAuthorized
    this.#readCurrentAssignment = options.readCurrentAssignment
  }

  get hostId(): string {
    return this.#hostId
  }

  get operations() {
    return [...HARNESS_EXECUTION_CONTRACT.operations]
  }

  async invoke(envelopeInput: unknown, payload: unknown) {
    const parsedEnvelope = parseKernelInvocationEnvelope(envelopeInput)
    if (!parsedEnvelope.success)
      return this.#invalidRequest('Kernel Invocation Envelope is invalid')
    const envelope = parsedEnvelope.data
    if (envelope.contract.id !== 'harness.execution' || envelope.contract.version !== '1.0.0') {
      return this.#invalidRequest('Unsupported Harness Execution Capability Contract')
    }
    if (
      envelope.selectedContribution.packageId !== this.#contribution.packageId ||
      envelope.selectedContribution.contributionId !== this.#contribution.contributionId
    ) {
      throw new HarnessExecutionConnectionError(
        'host_contribution_mismatch',
        'Kernel Invocation Envelope selects another Contribution'
      )
    }
    const parsedRequest = parseHarnessExecutionRequest({
      operation: envelope.operation,
      payload,
    })
    if (!parsedRequest.success) return this.#invalidRequest('Harness execution request is invalid')

    const request = parsedRequest.data.payload
    if (!this.#isHostAuthorized()) {
      throw new HarnessExecutionConnectionError(
        'host_authentication_required',
        'Desktop Host is disconnected or revoked'
      )
    }
    const assignment = this.#readCurrentAssignment()
    if (
      !assignment ||
      assignment.hostId !== this.#hostId ||
      assignment.providerId !== this.#providerId ||
      assignment.workspaceBindingId !== envelope.scope.id ||
      assignment.generation !== envelope.generation ||
      (typeof request.bindingId === 'string' && request.bindingId !== assignment.bindingId) ||
      (typeof request.workspaceBindingId === 'string' &&
        request.workspaceBindingId !== assignment.workspaceBindingId) ||
      (typeof request.generation === 'number' && request.generation !== assignment.generation)
    ) {
      throw new HarnessExecutionConnectionError(
        'stale_generation',
        'Harness operation does not match the current Relay assignment'
      )
    }
    if (!this.#authorize(envelope)) {
      throw new HarnessExecutionConnectionError(
        'operation_unauthorized',
        'Harness operation is not authorized for this Principal and Scope'
      )
    }
    if (envelope.operation === 'turn.cancel') {
      const active = this.#activeTurns.get(turnKey(request))
      if (!active || active.principalId !== envelope.principal.id) {
        throw new HarnessExecutionConnectionError(
          'cancellation_mismatch',
          'Cancellation does not match active work owned by this Contribution'
        )
      }
    }

    const activeKey = envelope.operation === 'turn.start' ? turnKey(request) : undefined
    if (activeKey) {
      this.#activeTurns.set(activeKey, {
        principalId: envelope.principal.id,
        invocationId: envelope.invocationId,
      })
    }
    let output: unknown
    try {
      output = await this.#invokeContribution({
        operation: parsedRequest.data.operation,
        payload: structuredClone(request),
        envelope,
      })
    } finally {
      if (activeKey) this.#activeTurns.delete(activeKey)
    }
    if (!isProviderNeutralValue(output)) return this.#invalidOutput()
    if (envelope.operation !== 'turn.start') {
      const result = parseHarnessExecutionResult(envelope.operation, output)
      if (!result.success) return this.#invalidOutput()
      return { result: result.data }
    }

    this.#applyFence(output, envelope.generation)
    const stream = parseHarnessExecutionStream(output)
    if (!stream.success) return this.#invalidOutput()
    if (
      stream.data.some(
        (event) =>
          event.invocationId !== envelope.invocationId ||
          event.bindingId !== request.bindingId ||
          event.threadId !== request.threadId ||
          event.turnId !== request.turnId ||
          event.attemptId !== request.attemptId ||
          event.generation !== envelope.generation ||
          event.generation !== request.generation
      )
    ) {
      return this.#invalidOutput()
    }
    return { events: stream.data }
  }

  #invalidRequest(message: string): never {
    throw new HarnessExecutionConnectionError('invalid_host_request', message)
  }

  #invalidOutput(): never {
    throw new HarnessExecutionConnectionError(
      'invalid_host_output',
      'Desktop Host returned invalid or Provider-native output'
    )
  }

  #applyFence(output: unknown, generation: number): void {
    if (!Array.isArray(output)) return this.#invalidOutput()
    const fence = new GenerationStreamFence(generation)
    for (const event of output) {
      if (
        typeof event !== 'object' ||
        event === null ||
        typeof (event as Record<string, unknown>).generation !== 'number' ||
        typeof (event as Record<string, unknown>).sequence !== 'number' ||
        typeof (event as Record<string, unknown>).kind !== 'string'
      ) {
        return this.#invalidOutput()
      }
      const accepted = fence.accept(event as { generation: number; sequence: number; kind: string })
      if (!accepted.accepted) {
        throw new HarnessExecutionConnectionError(
          accepted.code,
          'Desktop Host stream event was rejected by the assignment fence'
        )
      }
    }
  }
}

function turnKey(payload: Record<string, unknown>): string {
  return [
    payload.bindingId,
    payload.threadId,
    payload.turnId,
    payload.attemptId,
    payload.generation,
  ].join('\0')
}

import { HARNESS_EXECUTION_CONTRACT, type KernelInvocationEnvelope } from '@voiceclaw/contracts'
import type { HarnessStreamRouter } from './stream-routing.js'

const routingPrincipal = { kind: 'contribution' as const, id: 'routing' }

interface ActiveAttempt {
  invocationId: string
  bindingId: string
  threadId: string
  turnId: string
  attemptId: string
  generation: number
  workspaceBindingId: string
  selectedContribution: {
    packageId: string
    contributionId: string
  }
}

interface CancelRequest {
  principal: { kind: string; id: string }
  bindingId: string
  threadId: string
  turnId: string
  attemptId: string
  generation: number
  reason: string
}

interface HarnessAttemptControllerOptions {
  activeAttempt: ActiveAttempt
  kernel: {
    invoke(
      envelope: KernelInvocationEnvelope,
      payload: Record<string, unknown>,
      context: { authenticatedPrincipal: typeof routingPrincipal }
    ): Promise<unknown>
  }
  router: HarnessStreamRouter
  authorizeCancel(principal: CancelRequest['principal']): boolean
  createInvocationId(): string
  createTraceId(): string
}

export class HarnessAttemptController {
  #terminal = false

  constructor(private readonly options: HarnessAttemptControllerOptions) {}

  async cancel(request: CancelRequest) {
    if (!this.options.authorizeCancel(request.principal)) {
      return { accepted: false as const, code: 'authorization_denied' as const }
    }
    if (!sameAttempt(request, this.options.activeAttempt)) {
      return { accepted: false as const, code: 'attempt_identity_mismatch' as const }
    }
    if (this.#terminal) {
      return { accepted: false as const, code: 'attempt_already_terminal' as const }
    }

    const invocationId = this.options.createInvocationId()
    await this.options.kernel.invoke(
      {
        contract: {
          id: HARNESS_EXECUTION_CONTRACT.id,
          version: HARNESS_EXECUTION_CONTRACT.version,
        },
        operation: 'turn.cancel',
        invocationId,
        principal: routingPrincipal,
        scope: { kind: 'workspace', id: this.options.activeAttempt.workspaceBindingId },
        selectedContribution: this.options.activeAttempt.selectedContribution,
        generation: this.options.activeAttempt.generation,
        trace: { traceId: this.options.createTraceId() },
        cancellation: { supported: false },
      },
      {
        bindingId: request.bindingId,
        threadId: request.threadId,
        turnId: request.turnId,
        attemptId: request.attemptId,
        generation: request.generation,
        reason: request.reason,
      },
      { authenticatedPrincipal: routingPrincipal }
    )
    const terminal = await this.options.router.terminate({ outcome: 'cancelled' })
    if (!terminal.accepted) return terminal
    this.#terminal = true
    return { accepted: true as const, outcome: 'cancelled' as const }
  }
}

function sameAttempt(request: CancelRequest, attempt: ActiveAttempt): boolean {
  return (
    request.bindingId === attempt.bindingId &&
    request.threadId === attempt.threadId &&
    request.turnId === attempt.turnId &&
    request.attemptId === attempt.attemptId &&
    request.generation === attempt.generation
  )
}

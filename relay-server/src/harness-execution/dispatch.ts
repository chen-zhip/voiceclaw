import {
  HARNESS_EXECUTION_CONTRACT,
  type HarnessExecutionEvent,
  type KernelInvocationEnvelope,
} from '@voiceclaw/contracts'
import type { AttemptOutcome, ConversationRouting } from './conversation-routing.js'
import type { ConversationThreadMappings } from './thread-mapping.js'
import { HarnessAttemptController } from './terminal-outcome.js'
import type { HarnessStreamRouter } from './stream-routing.js'

const routingPrincipal = { kind: 'contribution' as const, id: 'routing' }

export interface HarnessBindingInput {
  bindingId: string
  providerId: string
  workspaceBindingId: string
  generation: number
}

export interface HarnessAttemptIdentity {
  invocationId: string
  bindingId: string
  threadId: string
  turnId: string
  attemptId: string
  generation: number
}

export interface AcceptedHarnessAttempt {
  conversationId: string
  turnId: string
  attemptId: string
  identity: HarnessAttemptIdentity
  binding: HarnessBindingInput
  events: HarnessExecutionEvent[]
}

export type HarnessDispatchResult =
  | { status: 'dispatched'; accepted: AcceptedHarnessAttempt }
  | { status: 'queued'; turnId: string }

/**
 * Production port the STT/TTS Harness session uses to reach provider-neutral
 * Harness execution. Implemented by `HarnessExecutionDispatcher`.
 */
export interface HarnessRoutingPort {
  acceptTranscript(input: {
    conversationId: string
    text: string
    final: boolean
    binding: HarnessBindingInput
  }): Promise<HarnessDispatchResult>
  completeAttempt(accepted: AcceptedHarnessAttempt, outcome: AttemptOutcome): Promise<void>
  cancelController(
    accepted: AcceptedHarnessAttempt,
    router: HarnessStreamRouter
  ): HarnessAttemptController
}

interface KernelInvoker {
  invoke(
    envelope: KernelInvocationEnvelope,
    payload: Record<string, unknown>,
    context: { authenticatedPrincipal: typeof routingPrincipal }
  ): Promise<{ result: Record<string, unknown> } | { events: unknown[] }>
}

export interface HarnessExecutionDispatcherOptions {
  kernel: KernelInvoker
  routing: ConversationRouting
  mappings: ConversationThreadMappings
  /**
   * Relay-side identity of the Contribution that provides `harness.execution`.
   * Client selection never supplies this, so a client cannot redirect the
   * invocation to another installed provider.
   */
  selectedContribution: {
    packageId: string
    contributionId: string
  }
  createInvocationId: () => string
  createTraceId: () => string
}

export class HarnessExecutionDispatcher implements HarnessRoutingPort {
  constructor(private readonly options: HarnessExecutionDispatcherOptions) {}

  async acceptTranscript(input: {
    conversationId: string
    text: string
    final: boolean
    binding: HarnessBindingInput
  }): Promise<HarnessDispatchResult> {
    if (!input.final) return { status: 'queued', turnId: '' }

    const turn = this.options.routing.accept(input.conversationId, { text: input.text })
    if (this.options.routing.inspect(input.conversationId).active) {
      // One active Harness Turn per Conversation: the later input stays visibly
      // queued instead of failing the session or dispatching concurrently.
      return { status: 'queued', turnId: turn.id }
    }

    const attempt = this.options.routing.dispatch(input.conversationId, turn.id)
    try {
      const mapping = await this.options.mappings.ensure(
        {
          conversationId: input.conversationId,
          providerId: input.binding.providerId,
          workspaceId: input.binding.workspaceBindingId,
        },
        async () => {
          const response = await this.options.kernel.invoke(
            this.#envelope('thread.ensure', input.binding),
            {
              bindingId: input.binding.bindingId,
              workspaceBindingId: input.binding.workspaceBindingId,
              conversationId: input.conversationId,
            },
            { authenticatedPrincipal: routingPrincipal }
          )
          if (!('result' in response) || !isNonempty(response.result.threadId)) {
            throw new Error('Harness thread.ensure did not return a Thread identity')
          }
          return response.result.threadId
        }
      )
      if (mapping.status === 'dormant') throw new Error('Harness Thread Mapping is dormant')

      const envelope = this.#envelope('turn.start', input.binding)
      const response = await this.options.kernel.invoke(
        envelope,
        {
          bindingId: input.binding.bindingId,
          threadId: mapping.threadId,
          turnId: turn.id,
          attemptId: attempt.id,
          generation: input.binding.generation,
          input: { text: input.text },
        },
        { authenticatedPrincipal: routingPrincipal }
      )

      return {
        status: 'dispatched',
        accepted: {
          conversationId: input.conversationId,
          turnId: turn.id,
          attemptId: attempt.id,
          identity: {
            invocationId: envelope.invocationId,
            bindingId: input.binding.bindingId,
            threadId: mapping.threadId,
            turnId: turn.id,
            attemptId: attempt.id,
            generation: input.binding.generation,
          },
          binding: input.binding,
          events: harnessEvents(response),
        },
      }
    } catch (error) {
      this.options.routing.abortDispatch(input.conversationId, attempt.id)
      throw error
    }
  }

  async completeAttempt(accepted: AcceptedHarnessAttempt, outcome: AttemptOutcome): Promise<void> {
    const attempt = this.options.routing.inspectAttempt(accepted.conversationId, accepted.attemptId)
    if (!attempt || attempt.outcome) return
    this.options.routing.endAttempt(accepted.conversationId, accepted.attemptId, outcome)
  }

  cancelController(
    accepted: AcceptedHarnessAttempt,
    router: HarnessStreamRouter
  ): HarnessAttemptController {
    return new HarnessAttemptController({
      activeAttempt: {
        ...accepted.identity,
        workspaceBindingId: accepted.binding.workspaceBindingId,
        selectedContribution: this.options.selectedContribution,
      },
      kernel: this.options.kernel,
      router,
      authorizeCancel: (principal) => principal.kind === 'user',
      createInvocationId: this.options.createInvocationId,
      createTraceId: this.options.createTraceId,
    })
  }

  #envelope(operation: 'thread.ensure' | 'turn.start', binding: HarnessBindingInput) {
    const invocationId = this.options.createInvocationId()
    return {
      contract: {
        id: HARNESS_EXECUTION_CONTRACT.id,
        version: HARNESS_EXECUTION_CONTRACT.version,
      },
      operation,
      invocationId,
      principal: routingPrincipal,
      scope: { kind: 'workspace', id: binding.workspaceBindingId },
      selectedContribution: this.options.selectedContribution,
      generation: binding.generation,
      trace: { traceId: this.options.createTraceId() },
      cancellation:
        operation === 'turn.start'
          ? { supported: true, token: `cancel-${invocationId}` }
          : { supported: false },
    } satisfies KernelInvocationEnvelope
  }
}

function harnessEvents(
  response: { result: Record<string, unknown> } | { events: unknown[] }
): HarnessExecutionEvent[] {
  if (!('events' in response) || !Array.isArray(response.events)) return []
  return response.events.filter(isHarnessExecutionEvent)
}

function isHarnessExecutionEvent(value: unknown): value is HarnessExecutionEvent {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.invocationId === 'string' &&
    typeof candidate.bindingId === 'string' &&
    typeof candidate.threadId === 'string' &&
    typeof candidate.turnId === 'string' &&
    typeof candidate.attemptId === 'string' &&
    typeof candidate.generation === 'number' &&
    typeof candidate.sequence === 'number' &&
    typeof candidate.kind === 'string' &&
    typeof candidate.payload === 'object' &&
    candidate.payload !== null
  )
}

function isNonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

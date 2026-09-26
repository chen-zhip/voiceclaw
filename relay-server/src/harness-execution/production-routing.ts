import type { ControlStateStore } from '../plugin-kernel/control-state-store.js'
import {
  HarnessExecutionDispatcher,
  type AcceptedHarnessAttempt,
  type HarnessBindingInput,
  type HarnessDispatchResult,
  type HarnessRoutingPort,
} from './dispatch.js'
import type { ConversationRouting, AttemptOutcome } from './conversation-routing.js'
import type { ConversationThreadMappings } from './thread-mapping.js'
import type { HarnessStreamRouter } from './stream-routing.js'
import type { HarnessAttemptController } from './terminal-outcome.js'
import { selectConversationPipeline } from './pipeline-selection.js'

export class HarnessBindingUnavailableError extends Error {
  constructor(message = 'Harness Host binding is unavailable') {
    super(message)
    this.name = 'HarnessBindingUnavailableError'
  }
}

export interface ProductionHarnessRoutingOptions {
  kernel: ConstructorParameters<typeof HarnessExecutionDispatcher>[0]['kernel']
  controlState: ControlStateStore
  routing: ConversationRouting
  mappings: ConversationThreadMappings
  selectedContribution: { packageId: string; contributionId: string }
  createInvocationId: () => string
  createTraceId: () => string
}

/**
 * Production `HarnessRoutingPort`: validates the client's binding selection
 * against the Relay-owned Active Host Assignment before any Host invocation,
 * and takes the generation from that assignment rather than from the client.
 */
export function createProductionHarnessRouting(
  options: ProductionHarnessRoutingOptions
): HarnessRoutingPort {
  const dispatcher = new HarnessExecutionDispatcher({
    kernel: options.kernel,
    routing: options.routing,
    mappings: options.mappings,
    selectedContribution: options.selectedContribution,
    createInvocationId: options.createInvocationId,
    createTraceId: options.createTraceId,
  })

  return {
    async acceptTranscript(input: {
      conversationId: string
      text: string
      final: boolean
      binding: HarnessBindingInput
    }): Promise<HarnessDispatchResult> {
      // The store supplies binding data; live Host readiness is enforced by the
      // Kernel, so the reader reports readiness for a matched assignment.
      const decision = selectConversationPipeline(
        { mode: 'stt-tts', harnessBinding: input.binding },
        {},
        { inspect: (bindingId) => inspectAssignment(options.controlState, bindingId) }
      )
      if (!decision.accepted) throw new HarnessBindingUnavailableError()
      if (!('binding' in decision) || !decision.binding) {
        throw new HarnessBindingUnavailableError()
      }

      return dispatcher.acceptTranscript({
        ...input,
        binding: { ...input.binding, generation: decision.binding.generation },
      })
    },
    completeAttempt(accepted: AcceptedHarnessAttempt, outcome: AttemptOutcome): Promise<void> {
      return dispatcher.completeAttempt(accepted, outcome)
    },
    cancelController(
      accepted: AcceptedHarnessAttempt,
      router: HarnessStreamRouter
    ): HarnessAttemptController {
      return dispatcher.cancelController(accepted, router)
    },
  }
}

function inspectAssignment(controlState: ControlStateStore, bindingId: string) {
  const assignment = controlState
    .read()
    .assignments.find((candidate) => candidate.bindingId === bindingId)
  if (
    !assignment ||
    assignment.providerId === undefined ||
    assignment.workspaceBindingId === undefined
  ) {
    throw new HarnessBindingUnavailableError()
  }
  return {
    bindingId: assignment.bindingId,
    hostId: assignment.hostId,
    providerId: assignment.providerId,
    workspaceBindingId: assignment.workspaceBindingId,
    generation: assignment.generation,
    status: 'ready' as const,
  }
}

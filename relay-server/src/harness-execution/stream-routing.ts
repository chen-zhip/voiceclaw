import type { HarnessExecutionEvent } from '@voiceclaw/contracts'
import { validateHostRpcOutput } from '../plugin-kernel/private-reasoning-boundary.js'

type AttemptIdentity = Omit<HarnessExecutionEvent, 'sequence' | 'kind' | 'payload'>

export interface HarnessStreamRouterDependencies {
  activeAttempt: AttemptIdentity
  speech: {
    write(text: string): Promise<void>
    finish?(): Promise<void>
    abort?(): void
  }
  sendToClient(event: HarnessClientProjection): void
  acceptedEventConsumers?: Array<(event: HarnessExecutionEvent) => void | Promise<void>>
}

export type HarnessClientProjection =
  | {
      type: 'harness.semantic-output'
      classification: 'public-screen'
      text: string
    }
  | {
      type: 'harness.presentation-state'
      classification: 'presentation-state'
      state: Record<string, unknown>
    }
  | {
      type: 'harness.outcome-evidence'
      classification: 'outcome-evidence'
      evidence: Record<string, unknown>
    }
  | {
      type: 'harness.terminal'
      classification: 'terminal'
      outcome: Record<string, unknown>
    }

export class HarnessStreamRouter {
  #lastSequence = 0
  #terminal = false

  constructor(private readonly dependencies: HarnessStreamRouterDependencies) {}

  async route(
    event: HarnessExecutionEvent
  ): Promise<{ accepted: true } | { accepted: false; code: string }> {
    const rejection = this.#validate(event)
    if (rejection) return { accepted: false, code: rejection }

    this.#lastSequence = event.sequence
    if (event.kind === 'terminal') this.#terminal = true

    if (event.kind === 'semantic-output') {
      if (
        event.payload.audience === 'public' &&
        event.payload.channel === 'speech' &&
        typeof event.payload.text === 'string'
      ) {
        await this.dependencies.speech.write(event.payload.text)
      }
      if (
        event.payload.audience === 'public' &&
        event.payload.channel === 'screen' &&
        typeof event.payload.text === 'string'
      ) {
        this.dependencies.sendToClient({
          type: 'harness.semantic-output',
          classification: 'public-screen',
          text: event.payload.text,
        })
      }
    } else if (event.kind === 'presentation-state') {
      this.dependencies.sendToClient({
        type: 'harness.presentation-state',
        classification: 'presentation-state',
        state: structuredClone(event.payload),
      })
    } else if (event.kind === 'outcome-evidence') {
      this.dependencies.sendToClient({
        type: 'harness.outcome-evidence',
        classification: 'outcome-evidence',
        evidence: structuredClone(event.payload),
      })
    } else if (event.kind === 'terminal') {
      if (event.payload.outcome === 'cancelled') this.dependencies.speech.abort?.()
      else await this.dependencies.speech.finish?.()
      this.dependencies.sendToClient({
        type: 'harness.terminal',
        classification: 'terminal',
        outcome: structuredClone(event.payload),
      })
    }
    await Promise.all(
      (this.dependencies.acceptedEventConsumers ?? []).map((consumer) =>
        consumer(structuredClone(event))
      )
    )
    return { accepted: true }
  }

  terminate(outcome: Record<string, unknown>) {
    const identity = this.dependencies.activeAttempt
    return this.route({
      invocationId: identity.invocationId,
      bindingId: identity.bindingId,
      threadId: identity.threadId,
      turnId: identity.turnId,
      attemptId: identity.attemptId,
      generation: identity.generation,
      sequence: this.#lastSequence + 1,
      kind: 'terminal',
      payload: structuredClone(outcome),
    })
  }

  #validate(event: HarnessExecutionEvent): string | undefined {
    if (!sameIdentity(event, this.dependencies.activeAttempt)) return 'attempt_identity_mismatch'
    if (this.#terminal) return 'attempt_already_terminal'
    if (event.sequence !== this.#lastSequence + 1) return 'invalid_sequence'
    if (event.kind === 'terminal') {
      return isTerminalOutcome(event.payload) ? undefined : 'invalid_terminal_outcome'
    }
    const boundary = validateHostRpcOutput({ class: event.kind, content: event.payload })
    if (!boundary.accepted) return boundary.code
    if (event.kind === 'semantic-output' && !isPublicSemanticOutput(event.payload)) {
      return 'invalid_output_class'
    }
    return undefined
  }
}

function isTerminalOutcome(payload: Record<string, unknown>): boolean {
  return (
    payload.outcome === 'completed' ||
    payload.outcome === 'failed' ||
    payload.outcome === 'cancelled' ||
    payload.outcome === 'outcome-unknown'
  )
}

function sameIdentity(event: HarnessExecutionEvent, identity: AttemptIdentity): boolean {
  return (
    event.invocationId === identity.invocationId &&
    event.bindingId === identity.bindingId &&
    event.threadId === identity.threadId &&
    event.turnId === identity.turnId &&
    event.attemptId === identity.attemptId &&
    event.generation === identity.generation
  )
}

function isPublicSemanticOutput(payload: Record<string, unknown>): boolean {
  return (
    payload.audience === 'public' &&
    (payload.channel === 'speech' || payload.channel === 'screen') &&
    typeof payload.text === 'string'
  )
}

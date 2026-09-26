import type { AttemptOutcome } from './conversation-routing.js'
import type { AcceptedHarnessAttempt, HarnessBindingInput, HarnessRoutingPort } from './dispatch.js'
import { HarnessStreamRouter, type HarnessClientProjection } from './stream-routing.js'
import { HarnessSpeechDelivery } from './tts-delivery.js'
import type { TTSProvider } from '../tts/interface.js'

export interface HarnessAttemptSessionOptions {
  routing: HarnessRoutingPort
  tts: TTSProvider
  sentenceBatchSize?: number
  sendToClient(event: HarnessClientProjection | Record<string, unknown>): void
  warn?(message: string): void
  /**
   * Identity of the authenticated Relay Session that owns this Harness session.
   * Cancellation is authorized only for that principal.
   */
  cancelPrincipal: { kind: string; id: string }
}

export type HarnessAcceptance = 'dispatched' | 'queued'

/**
 * Owns the Relay-side half of one STT/TTS Harness session: it turns accepted
 * Host stream events into public Client projections and TTS audio, enforces a
 * single terminal outcome, and exposes explicit cancellation.
 */
export class HarnessAttemptSession {
  readonly #routing: HarnessRoutingPort
  readonly #speech: HarnessSpeechDelivery
  readonly #sendToClient: (event: HarnessClientProjection | Record<string, unknown>) => void
  readonly #warn: ((message: string) => void) | undefined
  readonly #cancelPrincipal: { kind: string; id: string }
  #active: { accepted: AcceptedHarnessAttempt; router: HarnessStreamRouter } | null = null
  #terminal = false

  constructor(options: HarnessAttemptSessionOptions) {
    this.#routing = options.routing
    this.#sendToClient = options.sendToClient
    this.#warn = options.warn
    this.#cancelPrincipal = options.cancelPrincipal
    this.#speech = new HarnessSpeechDelivery({
      tts: options.tts,
      ...(options.sentenceBatchSize === undefined
        ? {}
        : { sentenceBatchSize: options.sentenceBatchSize }),
      sendToClient: (event) => this.#sendToClient(event),
      ...(options.warn ? { warn: options.warn } : {}),
    })
  }

  async accept(
    conversationId: string,
    text: string,
    binding: HarnessBindingInput
  ): Promise<HarnessAcceptance> {
    const result = await this.#routing.acceptTranscript({
      conversationId,
      text,
      final: true,
      binding,
    })
    if (result.status === 'queued') return 'queued'

    const accepted = result.accepted
    const router = new HarnessStreamRouter({
      activeAttempt: accepted.identity,
      speech: this.#speech,
      sendToClient: (event) => this.#sendToClient(event),
    })
    this.#active = { accepted, router }
    this.#terminal = false
    void this.#drive(accepted, router)
    return 'dispatched'
  }

  async cancel(reason: string): Promise<{ accepted: true } | { accepted: false; code: string }> {
    const active = this.#active
    if (!active || this.#terminal) return { accepted: false, code: 'attempt_already_terminal' }

    const controller = this.#routing.cancelController(active.accepted, active.router)
    const identity = active.accepted.identity
    const result = await controller.cancel({
      principal: this.#cancelPrincipal,
      bindingId: identity.bindingId,
      threadId: identity.threadId,
      turnId: identity.turnId,
      attemptId: identity.attemptId,
      generation: identity.generation,
      reason,
    })
    if (!result.accepted) return result

    this.#terminal = true
    await this.#routing.completeAttempt(active.accepted, 'cancelled')
    return { accepted: true }
  }

  async #drive(accepted: AcceptedHarnessAttempt, router: HarnessStreamRouter): Promise<void> {
    let terminalPayload: Record<string, unknown> | undefined
    try {
      for (const event of accepted.events) {
        const result = await router.route(event)
        if (!result.accepted) {
          this.#warn?.(`Harness stream event rejected: ${result.code}`)
          continue
        }
        if (event.kind === 'terminal') {
          terminalPayload = event.payload
          break
        }
      }
      if (!terminalPayload) {
        // The Host stream ended without a terminal event: the Attempt is
        // terminal but its side effects cannot be proven, so do not replay it.
        await router.terminate({ outcome: 'outcome-unknown' })
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      this.#warn?.(`Harness stream failed: ${detail}`)
      if (!terminalPayload) terminalPayload = { outcome: 'outcome-unknown' }
    }

    this.#terminal = true
    await this.#routing.completeAttempt(accepted, toAttemptOutcome(terminalPayload))
  }
}

function toAttemptOutcome(payload: Record<string, unknown> | undefined): AttemptOutcome {
  switch (payload?.outcome) {
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'unknown'
  }
}

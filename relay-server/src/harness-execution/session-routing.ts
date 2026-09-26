import type { AttemptOutcome } from './conversation-routing.js'
import type { AcceptedHarnessAttempt, HarnessBindingInput, HarnessRoutingPort } from './dispatch.js'
import { HarnessStreamRouter, type HarnessClientProjection } from './stream-routing.js'
import { HarnessSpeechDelivery } from './tts-delivery.js'
import type { TTSProvider } from '../tts/interface.js'
import type { SttTtsDebugRecorder } from '../stt-tts-debug.js'

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
  debugRecorder?: SttTtsDebugRecorder
  ttsProviderId?: string
}

export type HarnessAcceptance = 'dispatched' | 'queued'

type ActiveSessionAttempt = {
  accepted: AcceptedHarnessAttempt
  router: HarnessStreamRouter
  terminal: boolean
  cancelled: boolean
}

/**
 * Owns the Relay-side half of one STT/TTS Harness session: it turns accepted
 * Host stream events into public Client projections and TTS audio, enforces a
 * single terminal outcome, and exposes explicit cancellation.
 */
export class HarnessAttemptSession {
  readonly #routing: HarnessRoutingPort
  readonly #createSpeech: () => HarnessSpeechDelivery
  readonly #sendToClient: (event: HarnessClientProjection | Record<string, unknown>) => void
  readonly #warn: ((message: string) => void) | undefined
  readonly #cancelPrincipal: { kind: string; id: string }
  readonly #debugRecorder: SttTtsDebugRecorder | undefined
  #sessionId = ''
  #active: ActiveSessionAttempt | null = null

  constructor(options: HarnessAttemptSessionOptions) {
    this.#routing = options.routing
    this.#sendToClient = options.sendToClient
    this.#warn = options.warn
    this.#cancelPrincipal = options.cancelPrincipal
    this.#debugRecorder = options.debugRecorder
    this.#createSpeech = () =>
      new HarnessSpeechDelivery({
        tts: options.tts,
        ...(options.sentenceBatchSize === undefined
          ? {}
          : { sentenceBatchSize: options.sentenceBatchSize }),
        sendToClient: (event) => this.#sendToClient(event),
        ...(options.warn ? { warn: options.warn } : {}),
        ...(options.debugRecorder ? { debugRecorder: options.debugRecorder } : {}),
        debugContext: () => ({
          ...(this.#sessionId ? { sessionId: this.#sessionId } : {}),
          ...(this.#active
            ? {
                turnId: this.#active.accepted.identity.turnId,
                attemptId: this.#active.accepted.identity.attemptId,
              }
            : {}),
          ...(options.ttsProviderId ? { providerId: options.ttsProviderId } : {}),
        }),
      })
  }

  async accept(
    conversationId: string,
    text: string,
    binding: HarnessBindingInput
  ): Promise<HarnessAcceptance> {
    this.#sessionId = conversationId
    const startedAt = Date.now()
    this.#debugRecorder?.record('harness.dispatch.start', {
      sessionId: conversationId,
      stage: 'harness',
      providerId: binding.providerId,
    })
    let result
    let dispatched: ActiveSessionAttempt | undefined
    const activate = (accepted: AcceptedHarnessAttempt) => {
      const router = new HarnessStreamRouter({
        activeAttempt: accepted.identity,
        speech: this.#createSpeech(),
        sendToClient: (event) => this.#sendToClient(event),
        acceptedEventConsumers: [(event) => this.#recordAcceptedEvent(accepted, event)],
      })
      dispatched = { accepted, router, terminal: false, cancelled: false }
      this.#active = dispatched
      return dispatched
    }
    try {
      result = await this.#routing.acceptTranscript({
        conversationId,
        text,
        final: true,
        binding,
        onDispatched: activate,
      })
    } catch (error) {
      if (dispatched?.cancelled) return 'dispatched'
      this.#debugRecorder?.record('harness.failed', {
        sessionId: conversationId,
        stage: 'harness',
        providerId: binding.providerId,
        durationMs: Math.max(0, Date.now() - startedAt),
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
    if (result.status === 'queued') {
      this.#debugRecorder?.record('harness.dispatch.queued', {
        sessionId: conversationId,
        stage: 'harness',
        providerId: binding.providerId,
        turnId: result.turnId,
        durationMs: Math.max(0, Date.now() - startedAt),
      })
      return 'queued'
    }

    const accepted = result.accepted
    this.#debugRecorder?.record('harness.dispatch.complete', {
      ...this.#attemptFields(accepted),
      durationMs: Math.max(0, Date.now() - startedAt),
    })
    const active = dispatched ?? activate(accepted)
    if (!active.terminal) void this.#drive(active)
    return 'dispatched'
  }

  async cancel(reason: string): Promise<{ accepted: true } | { accepted: false; code: string }> {
    const active = this.#active
    if (!active || active.terminal) return { accepted: false, code: 'attempt_already_terminal' }

    const controller = this.#routing.cancelController(active.accepted, active.router)
    const identity = active.accepted.identity
    const result = await controller
      .cancel({
        principal: this.#cancelPrincipal,
        bindingId: identity.bindingId,
        threadId: identity.threadId,
        turnId: identity.turnId,
        attemptId: identity.attemptId,
        generation: identity.generation,
        reason,
      })
      .catch((error: unknown) => {
        this.#warn?.(
          `Harness cancellation failed: ${error instanceof Error ? error.message : String(error)}`
        )
        this.#sendToClient({
          type: 'error',
          code: 409,
          message: 'Unable to cancel this turn. Check the provider thread before retrying.',
        })
        return { accepted: false as const, code: 'cancellation_failed' }
      })
    if (!result.accepted) return result

    active.terminal = true
    active.cancelled = true
    this.#debugRecorder?.record('harness.cancelled', {
      ...this.#attemptFields(active.accepted),
      reason,
    })
    await this.#routing.completeAttempt(active.accepted, 'cancelled')
    return { accepted: true }
  }

  async #drive(active: ActiveSessionAttempt): Promise<void> {
    const { accepted, router } = active
    let terminalPayload: Record<string, unknown> | undefined
    try {
      for (const event of accepted.events) {
        if (active.terminal) return
        const result = await router.route(event)
        if (!result.accepted) {
          this.#debugRecorder?.record('harness.stream.rejected', {
            ...this.#attemptFields(accepted),
            sequence: event.sequence,
            status: result.code,
          })
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
      this.#debugRecorder?.record('harness.failed', {
        ...this.#attemptFields(accepted),
        error: detail,
      })
      this.#warn?.(`Harness stream failed: ${detail}`)
      if (!terminalPayload) terminalPayload = { outcome: 'outcome-unknown' }
    }

    if (active.terminal) return
    active.terminal = true
    await this.#routing.completeAttempt(accepted, toAttemptOutcome(terminalPayload))
  }

  #recordAcceptedEvent(
    accepted: AcceptedHarnessAttempt,
    event: { sequence: number; kind: string; payload: Record<string, unknown> }
  ): void {
    if (
      event.kind === 'semantic-output' &&
      event.payload.audience === 'public' &&
      event.payload.channel === 'speech' &&
      typeof event.payload.text === 'string'
    ) {
      this.#debugRecorder?.record('harness.speech.received', {
        ...this.#attemptFields(accepted),
        sequence: event.sequence,
        speechCharacters: event.payload.text.length,
      })
    }
    if (event.kind === 'terminal') {
      this.#debugRecorder?.record('harness.terminal', {
        ...this.#attemptFields(accepted),
        sequence: event.sequence,
        ...(typeof event.payload.outcome === 'string' ? { outcome: event.payload.outcome } : {}),
      })
    }
  }

  #attemptFields(accepted: AcceptedHarnessAttempt) {
    return {
      sessionId: this.#sessionId || accepted.conversationId,
      stage: 'harness' as const,
      providerId: accepted.binding.providerId,
      turnId: accepted.identity.turnId,
      attemptId: accepted.identity.attemptId,
    }
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

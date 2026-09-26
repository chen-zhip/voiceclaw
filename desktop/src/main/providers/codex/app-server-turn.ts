import { isNonemptyString, isRecord, type HarnessExecutionEvent } from '@voiceclaw/contracts'
import {
  classifyCodexFailure,
  codexOutcomeForFailure,
  type CodexFailure,
  type CodexFailureSignal,
} from './codex-failure.js'
import { CODEX_OUTPUT_SCHEMA, parseCodexCompletion } from './codex-output.js'

export interface CodexTurnCorrelation {
  invocationId: string
  bindingId: string
  threadId: string
  turnId: string
  attemptId: string
  generation: number
}

export interface CodexNativeNotification {
  method: string
  params: Record<string, unknown>
}

export type CodexTurnEventKind = HarnessExecutionEvent['kind']

export class CodexTurnError extends Error {
  constructor(
    readonly code: 'codex_turn_start_failed' | 'codex_turn_cancel_failed',
    message: string
  ) {
    super(message)
    this.name = 'CodexTurnError'
  }
}

const ITEM_FACTS: Record<string, string> = {
  commandExecution: 'command-execution',
  fileChange: 'file-change',
  mcpToolCall: 'tool-call',
  dynamicToolCall: 'tool-call',
  webSearch: 'web-search',
}

const DROPPED_METHODS = new Set([
  'item/reasoning/textDelta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded',
])

// House timeout for a Harness operation. A Codex Turn that reports no progress
// for this long (for example while the Provider retries a lost connection
// forever) must end with one normalized terminal instead of never ending.
const DEFAULT_TURN_IDLE_TIMEOUT_MS = 120_000

export class CodexTurnStream {
  #sequence = 0
  #finished = false
  #correlation: CodexTurnCorrelation | undefined
  #nativeThreadId: string | undefined
  #nativeTurnId: string | undefined
  #failure: CodexFailure | null = null
  #flushing = false
  readonly #idleTimeoutMs: number
  #idleTimer: ReturnType<typeof setTimeout> | undefined
  readonly #buffered: CodexNativeNotification[] = []
  readonly #agentMessageDeltas = new Map<string, string>()
  readonly #completedAgentMessages = new Set<string>()
  readonly #handlers: Array<(event: HarnessExecutionEvent) => void> = []
  readonly #terminal: Promise<HarnessExecutionEvent>
  #resolveTerminal: ((event: HarnessExecutionEvent) => void) | undefined

  constructor(
    private readonly boundary: {
      request(method: string, params: Record<string, unknown>): Promise<unknown>
      idleTimeoutMs?: number
    }
  ) {
    this.#idleTimeoutMs = boundary.idleTimeoutMs ?? DEFAULT_TURN_IDLE_TIMEOUT_MS
    this.#terminal = new Promise((resolve) => {
      this.#resolveTerminal = resolve
    })
  }

  get terminal(): Promise<HarnessExecutionEvent> {
    return this.#terminal
  }

  onEvent(handler: (event: HarnessExecutionEvent) => void): void {
    this.#handlers.push(handler)
  }

  get failure(): CodexFailure | null {
    return this.#failure ? { ...this.#failure } : null
  }

  async start(input: {
    correlation: CodexTurnCorrelation
    nativeThreadId: string
    text: string
    model?: string
  }): Promise<{ nativeTurnId: string }> {
    const response = await this.boundary.request('turn/start', {
      threadId: input.nativeThreadId,
      input: [{ type: 'text', text: input.text }],
      ...(input.model ? { model: input.model } : {}),
      outputSchema: CODEX_OUTPUT_SCHEMA,
    })
    const nativeTurnId =
      isRecord(response) && isRecord(response.turn) ? response.turn.id : undefined
    if (!isNonemptyString(nativeTurnId)) {
      throw new CodexTurnError(
        'codex_turn_start_failed',
        'Codex app-server returned an unusable Turn response'
      )
    }
    this.#correlation = structuredClone(input.correlation)
    this.#nativeThreadId = input.nativeThreadId
    this.#nativeTurnId = nativeTurnId
    this.#armIdleDeadline()
    this.#flush()
    return { nativeTurnId }
  }

  dispatch(notification: CodexNativeNotification): void {
    if (this.#finished) return
    if (!this.#correlation) {
      this.#buffered.push(notification)
      return
    }
    const correlation = this.#correlation
    const params = notification.params
    if (params.threadId !== this.#nativeThreadId) return
    const candidateTurnId =
      typeof params.turnId === 'string'
        ? params.turnId
        : isRecord(params.turn) && typeof params.turn.id === 'string'
          ? params.turn.id
          : undefined
    if (candidateTurnId !== undefined && candidateTurnId !== this.#nativeTurnId) return
    if (DROPPED_METHODS.has(notification.method)) return

    if (notification.method === 'item/agentMessage/delta') {
      if (isNonemptyString(params.delta)) {
        const itemId = isNonemptyString(params.itemId) ? params.itemId : '__default__'
        this.#agentMessageDeltas.set(
          itemId,
          `${this.#agentMessageDeltas.get(itemId) ?? ''}${params.delta}`
        )
        this.#armIdleDeadline()
      }
      return
    }
    if (notification.method === 'item/started' || notification.method === 'item/completed') {
      const item = isRecord(params.item) ? params.item : undefined
      if (notification.method === 'item/completed' && item?.type === 'agentMessage') {
        this.#emitCompletedAgentMessage(item)
      }
      const fact = isNonemptyString(item?.type) ? ITEM_FACTS[item.type] : undefined
      if (fact) {
        this.#emit('outcome-evidence', {
          fact,
          phase: notification.method === 'item/started' ? 'started' : 'completed',
        })
      }
      return
    }
    if (notification.method === 'thread/tokenUsage/updated') {
      const total = isRecord(params.tokenUsage) ? params.tokenUsage.total : undefined
      if (
        isRecord(total) &&
        typeof total.inputTokens === 'number' &&
        typeof total.outputTokens === 'number' &&
        typeof total.totalTokens === 'number'
      ) {
        this.#emit('outcome-evidence', {
          fact: 'token-usage',
          inputTokens: total.inputTokens,
          outputTokens: total.outputTokens,
          totalTokens: total.totalTokens,
        })
      }
      return
    }
    if (notification.method === 'turn/completed') {
      const status = isRecord(params.turn) ? params.turn.status : undefined
      const error =
        isRecord(params.turn) && isRecord(params.turn.error) ? params.turn.error : undefined
      if (status === 'completed' && isRecord(params.turn) && Array.isArray(params.turn.items)) {
        for (const item of params.turn.items) {
          if (isRecord(item) && item.type === 'agentMessage') {
            this.#emitCompletedAgentMessage(item)
          }
        }
      }
      if (status === 'completed') this.#finish('completed')
      if (status === 'failed') {
        this.#fail({ kind: 'provider-error', codexErrorInfo: error?.codexErrorInfo })
      }
      if (status === 'interrupted') this.#fail({ kind: 'interrupted' })
      return
    }
    if (notification.method === 'error') {
      const error = isRecord(params.error) ? params.error : undefined
      if (params.willRetry === false) {
        this.#fail({ kind: 'provider-error', codexErrorInfo: error?.codexErrorInfo })
      } else {
        this.#emitDiagnostic({ kind: 'provider-error', codexErrorInfo: error?.codexErrorInfo })
      }
    }
  }

  transportLost(): void {
    if (this.#finished || !this.#correlation) return
    this.#fail({ kind: 'transport-closed' })
  }

  #flush(): void {
    if (this.#flushing) return
    this.#flushing = true
    try {
      while (this.#buffered.length > 0 && !this.#finished) {
        const notification = this.#buffered.shift() as CodexNativeNotification
        this.dispatch(notification)
      }
    } finally {
      this.#flushing = false
    }
  }

  async cancel(input: { correlation: CodexTurnCorrelation }): Promise<void> {
    if (
      this.#finished ||
      !this.#correlation ||
      !this.#nativeThreadId ||
      !this.#nativeTurnId ||
      !sameCorrelation(this.#correlation, input.correlation)
    ) {
      throw new CodexTurnError(
        'codex_turn_cancel_failed',
        'No matching active Codex Turn can be interrupted'
      )
    }
    await this.boundary.request('turn/interrupt', {
      threadId: this.#nativeThreadId,
      turnId: this.#nativeTurnId,
    })
  }

  #emit(kind: CodexTurnEventKind, payload: Record<string, unknown>): HarnessExecutionEvent {
    this.#sequence += 1
    const event: HarnessExecutionEvent = {
      ...(this.#correlation as CodexTurnCorrelation),
      sequence: this.#sequence,
      kind,
      payload: structuredClone(payload),
    }
    // Retry diagnostics are not progress: a Provider that only reports that it
    // is still trying must not be able to hold the binding open forever.
    if (kind !== 'diagnostic') this.#armIdleDeadline()
    for (const handler of this.#handlers) handler(structuredClone(event))
    return event
  }

  #emitPublicText(text: string): void {
    this.#emit('semantic-output', {
      audience: 'public',
      channel: 'speech',
      text,
    })
    this.#emit('semantic-output', {
      audience: 'public',
      channel: 'screen',
      text,
    })
  }

  #emitCompletedText(text: string): void {
    const parsed = parseCodexCompletion(text)
    if (!parsed.valid) {
      this.#emit('diagnostic', {
        class: 'provider-execution',
        code: `codex_output_schema_${parsed.code}`,
      })
      this.#emitPublicText(parsed.fallbackText)
      return
    }
    if (parsed.speechText.trim()) {
      this.#emit('semantic-output', {
        audience: 'public',
        channel: 'speech',
        text: parsed.speechText,
      })
    }
    this.#emit('semantic-output', {
      audience: 'public',
      channel: 'screen',
      text: parsed.screenText,
    })
  }

  #emitCompletedAgentMessage(item: Record<string, unknown>): void {
    const itemId = isNonemptyString(item.id) ? item.id : '__default__'
    if (this.#completedAgentMessages.has(itemId)) return
    const completedText = isNonemptyString(item.text)
      ? item.text
      : this.#agentMessageDeltas.get(itemId)
    this.#agentMessageDeltas.delete(itemId)
    if (!isNonemptyString(completedText)) return
    this.#completedAgentMessages.add(itemId)
    this.#emitCompletedText(completedText)
  }

  #finish(outcome: 'completed' | 'failed' | 'cancelled'): void {
    if (this.#finished) return
    const event = this.#emit('terminal', { outcome })
    this.#finished = true
    this.#clearIdleDeadline()
    this.#resolveTerminal?.(structuredClone(event))
  }

  #armIdleDeadline(): void {
    if (this.#finished || this.#idleTimeoutMs <= 0) return
    this.#clearIdleDeadline()
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = undefined
      this.#fail({ kind: 'stalled' })
      void this.#interruptStalledTurn()
    }, this.#idleTimeoutMs)
  }

  // A stalled Turn is still running inside the Provider; releasing the binding
  // without asking for an interrupt would leave the native Turn active and
  // block the next Turn on the same Thread.
  async #interruptStalledTurn(): Promise<void> {
    if (!this.#nativeThreadId || !this.#nativeTurnId) return
    try {
      await this.boundary.request('turn/interrupt', {
        threadId: this.#nativeThreadId,
        turnId: this.#nativeTurnId,
      })
    } catch {
      // The native Turn may be unreachable; the terminal outcome already stands.
    }
  }

  #clearIdleDeadline(): void {
    if (this.#idleTimer === undefined) return
    clearTimeout(this.#idleTimer)
    this.#idleTimer = undefined
  }

  #fail(signal: CodexFailureSignal): void {
    if (this.#finished) return
    const failure = classifyCodexFailure(signal)
    this.#failure = failure
    this.#emit('diagnostic', { class: failure.class, code: failure.code })
    this.#finish(codexOutcomeForFailure(failure))
  }

  #emitDiagnostic(signal: CodexFailureSignal): void {
    const failure = classifyCodexFailure(signal)
    this.#emit('diagnostic', { class: failure.class, code: failure.code })
  }
}

function sameCorrelation(active: CodexTurnCorrelation, candidate: CodexTurnCorrelation): boolean {
  return (
    active.invocationId === candidate.invocationId &&
    active.bindingId === candidate.bindingId &&
    active.threadId === candidate.threadId &&
    active.turnId === candidate.turnId &&
    active.attemptId === candidate.attemptId &&
    active.generation === candidate.generation
  )
}

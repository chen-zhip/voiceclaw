import { randomUUID } from 'node:crypto'

export interface ConversationTurn {
  id: string
  conversationId: string
  input: Record<string, unknown>
}

export interface HarnessExecutionAttempt {
  id: string
  turnId: string
}

export type AttemptOutcome = 'completed' | 'failed' | 'cancelled' | 'unknown'

export interface ConversationRoutingOptions {
  createTurnId?: () => string
  createAttemptId?: () => string
}

interface ConversationState {
  turns: Map<string, ConversationTurn>
  attempts: Map<string, HarnessExecutionAttempt & { outcome?: AttemptOutcome }>
  backlog: string[]
  active: {
    turnId: string
    attempt: HarnessExecutionAttempt
  } | null
}

export class ConversationRouting {
  readonly #createTurnId: () => string
  readonly #createAttemptId: () => string
  readonly #conversations = new Map<string, ConversationState>()

  constructor(options: ConversationRoutingOptions = {}) {
    this.#createTurnId = options.createTurnId ?? randomUUID
    this.#createAttemptId = options.createAttemptId ?? randomUUID
  }

  accept(conversationId: string, input: Record<string, unknown>): ConversationTurn {
    const state = this.#state(conversationId)
    const turn: ConversationTurn = {
      id: this.#createTurnId(),
      conversationId,
      input: structuredClone(input),
    }
    state.turns.set(turn.id, turn)
    state.backlog.push(turn.id)
    return structuredClone(turn)
  }

  dispatch(conversationId: string, turnId?: string): HarnessExecutionAttempt {
    const state = this.#state(conversationId)
    if (state.active) throw new Error('Conversation already has an active Harness Turn')

    const selectedTurnId = turnId ?? state.backlog[0]
    if (!selectedTurnId || !state.turns.has(selectedTurnId)) {
      throw new Error('Conversation Turn is not available for dispatch')
    }

    const backlogIndex = state.backlog.indexOf(selectedTurnId)
    if (backlogIndex >= 0) state.backlog.splice(backlogIndex, 1)

    const attempt = { id: this.#createAttemptId(), turnId: selectedTurnId }
    state.attempts.set(attempt.id, attempt)
    state.active = { turnId: selectedTurnId, attempt }
    return structuredClone(attempt)
  }

  release(conversationId: string, attemptId: string): void {
    const state = this.#state(conversationId)
    if (!state.active || state.active.attempt.id !== attemptId) {
      throw new Error('Harness Execution Attempt is not active')
    }
    state.active = null
  }

  abortDispatch(conversationId: string, attemptId: string): void {
    const state = this.#state(conversationId)
    if (!state.active || state.active.attempt.id !== attemptId) {
      throw new Error('Harness Execution Attempt is not active')
    }
    const turnId = state.active.turnId
    state.active = null
    state.attempts.delete(attemptId)
    if (!state.backlog.includes(turnId)) state.backlog.unshift(turnId)
  }

  endAttempt(conversationId: string, attemptId: string, outcome: AttemptOutcome): void {
    const state = this.#state(conversationId)
    if (!state.active || state.active.attempt.id !== attemptId) {
      throw new Error('Harness Execution Attempt is not active')
    }
    const attempt = state.attempts.get(attemptId)
    if (!attempt || attempt.outcome) {
      throw new Error('Harness Execution Attempt already has a terminal outcome')
    }
    state.attempts.set(attemptId, { ...attempt, outcome })
    state.active = null
  }

  inspectAttempt(
    conversationId: string,
    attemptId: string
  ): (HarnessExecutionAttempt & { outcome?: AttemptOutcome }) | undefined {
    const attempt = this.#state(conversationId).attempts.get(attemptId)
    return attempt ? structuredClone(attempt) : undefined
  }

  recover(
    conversationId: string,
    turnId: string,
    options: { acknowledgeOutcomeUnknownRisk?: boolean } = {}
  ):
    | { accepted: true; attempt: HarnessExecutionAttempt }
    | { accepted: false; code: string; risk?: string } {
    const state = this.#state(conversationId)
    if (state.active) return { accepted: false, code: 'conversation_turn_active' }
    const latest = [...state.attempts.values()]
      .reverse()
      .find((attempt) => attempt.turnId === turnId)
    if (!latest?.outcome) return { accepted: false, code: 'attempt_not_terminal' }
    if (latest.outcome === 'unknown' && !options.acknowledgeOutcomeUnknownRisk) {
      return {
        accepted: false,
        code: 'risk_acknowledgment_required',
        risk: 'Provider side effects may already have occurred',
      }
    }
    if (latest.outcome !== 'failed' && latest.outcome !== 'unknown') {
      return { accepted: false, code: 'terminal_outcome_not_recoverable' }
    }
    return { accepted: true, attempt: this.dispatch(conversationId, turnId) }
  }

  inspect(conversationId: string): {
    active: { turn: ConversationTurn; attempt: HarnessExecutionAttempt } | null
    backlog: ConversationTurn[]
  } {
    const state = this.#state(conversationId)
    const active = state.active
      ? {
          turn: structuredClone(state.turns.get(state.active.turnId)!),
          attempt: structuredClone(state.active.attempt),
        }
      : null
    return {
      active,
      backlog: state.backlog.map((turnId) => structuredClone(state.turns.get(turnId)!)),
    }
  }

  #state(conversationId: string): ConversationState {
    const existing = this.#conversations.get(conversationId)
    if (existing) return existing
    const created: ConversationState = {
      turns: new Map(),
      attempts: new Map(),
      backlog: [],
      active: null,
    }
    this.#conversations.set(conversationId, created)
    return created
  }
}

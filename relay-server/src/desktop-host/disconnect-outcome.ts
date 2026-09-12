import {
  isProviderNeutralValue,
  parseHarnessExecutionStream,
  type HarnessExecutionEvent,
} from '@voiceclaw/contracts'

type AttemptIdentity = Omit<HarnessExecutionEvent, 'sequence' | 'kind' | 'payload'>

export class HostInvocationAttemptError extends Error {
  constructor(
    readonly code: 'invalid_attempt_event' | 'attempt_already_terminal',
    message: string
  ) {
    super(message)
    this.name = 'HostInvocationAttemptError'
  }
}

export class HostInvocationAttempt {
  readonly #identity: AttemptIdentity
  readonly #input: Record<string, unknown>
  readonly #events: HarnessExecutionEvent[] = []
  #dispatched = false
  #terminal = false

  constructor(input: AttemptIdentity & { input: Record<string, unknown> }) {
    const { input: preservedInput, ...identity } = input
    if (!isProviderNeutralValue(preservedInput)) {
      throw new HostInvocationAttemptError('invalid_attempt_event', 'Attempt input is invalid')
    }
    this.#identity = structuredClone(identity)
    this.#input = structuredClone(preservedInput)
  }

  markDispatched(): void {
    if (this.#terminal) return this.#alreadyTerminal()
    this.#dispatched = true
  }

  acceptPublicEvent(event: HarnessExecutionEvent): void {
    if (this.#terminal) return this.#alreadyTerminal()
    const expectedSequence = (this.#events.at(-1)?.sequence ?? 0) + 1
    if (
      event.kind === 'terminal' ||
      event.sequence !== expectedSequence ||
      !sameIdentity(event, this.#identity) ||
      !isProviderNeutralValue(event.payload)
    ) {
      throw new HostInvocationAttemptError(
        'invalid_attempt_event',
        'Host event does not match the active Harness Execution Attempt'
      )
    }
    this.#events.push(structuredClone(event))
  }

  disconnect() {
    if (this.#terminal) return this.#alreadyTerminal()
    this.#terminal = true
    const terminal: HarnessExecutionEvent = {
      ...this.#identity,
      sequence: (this.#events.at(-1)?.sequence ?? 0) + 1,
      kind: 'terminal',
      payload: { outcome: this.#dispatched ? 'unknown' : 'failed' },
    }
    const events = [...this.#events, terminal]
    if (!parseHarnessExecutionStream(events).success) {
      throw new HostInvocationAttemptError(
        'invalid_attempt_event',
        'Disconnect outcome did not produce a valid Harness stream'
      )
    }
    return {
      input: structuredClone(this.#input),
      events: structuredClone(events),
      recovery: {
        automaticReplay: false as const,
        automaticHostSubstitution: false as const,
      },
    }
  }

  #alreadyTerminal(): never {
    throw new HostInvocationAttemptError(
      'attempt_already_terminal',
      'Harness Execution Attempt already has a terminal outcome'
    )
  }
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

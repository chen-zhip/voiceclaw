export type StreamFenceRejectionCode =
  | 'stale_generation'
  | 'out_of_order_sequence'
  | 'event_after_terminal'
  | 'second_terminal'

export class GenerationStreamFence {
  readonly #generation: number
  #lastSequence = 0
  #terminalAccepted = false

  constructor(generation: number) {
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw new TypeError('Authority generation must be a non-negative integer')
    }
    this.#generation = generation
  }

  accept(event: {
    generation: number
    sequence: number
    kind: string
  }): { accepted: true } | { accepted: false; code: StreamFenceRejectionCode } {
    if (event.generation !== this.#generation) {
      return { accepted: false, code: 'stale_generation' }
    }
    if (this.#terminalAccepted) {
      return {
        accepted: false,
        code: event.kind === 'terminal' ? 'second_terminal' : 'event_after_terminal',
      }
    }
    if (
      !Number.isSafeInteger(event.sequence) ||
      event.sequence < 1 ||
      event.sequence <= this.#lastSequence
    ) {
      return { accepted: false, code: 'out_of_order_sequence' }
    }

    this.#lastSequence = event.sequence
    if (event.kind === 'terminal') this.#terminalAccepted = true
    return { accepted: true }
  }
}

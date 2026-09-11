import { describe, expect, it } from 'vitest'
import * as fenceModule from '../../src/plugin-kernel/generation-fence.js'

describe('generation and stream fence', () => {
  it('rejects stale, unordered, and terminal-late events', () => {
    const GenerationStreamFence = (fenceModule as Record<string, unknown>).GenerationStreamFence as
      | (new (generation: number) => {
          accept(event: {
            generation: number
            sequence: number
            kind: string
          }): { accepted: true } | { accepted: false; code: string }
        })
      | undefined

    expect(typeof GenerationStreamFence).toBe('function')
    if (!GenerationStreamFence) return

    const stale = new GenerationStreamFence(3)
    expect(stale.accept({ generation: 2, sequence: 1, kind: 'semantic-output' })).toEqual({
      accepted: false,
      code: 'stale_generation',
    })

    const ordered = new GenerationStreamFence(3)
    expect(ordered.accept({ generation: 3, sequence: 1, kind: 'semantic-output' })).toEqual({
      accepted: true,
    })
    expect(ordered.accept({ generation: 3, sequence: 1, kind: 'presentation-state' })).toEqual({
      accepted: false,
      code: 'out_of_order_sequence',
    })
    expect(ordered.accept({ generation: 3, sequence: 0, kind: 'presentation-state' })).toEqual({
      accepted: false,
      code: 'out_of_order_sequence',
    })

    const terminal = new GenerationStreamFence(3)
    expect(terminal.accept({ generation: 3, sequence: 1, kind: 'terminal' })).toEqual({
      accepted: true,
    })
    expect(terminal.accept({ generation: 3, sequence: 2, kind: 'semantic-output' })).toEqual({
      accepted: false,
      code: 'event_after_terminal',
    })
    expect(terminal.accept({ generation: 3, sequence: 3, kind: 'terminal' })).toEqual({
      accepted: false,
      code: 'second_terminal',
    })
  })
})

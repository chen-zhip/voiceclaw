import { describe, expect, it } from 'vitest'
import { ClaudeCodeAdapter } from '../../src/harness-adapter/claude-code-adapter.js'
import { createHarnessAdapter, listHarnessAdapters } from '../../src/harness-adapter/registry.js'

describe('Harness adapter registry', () => {
  it('lists stable ids and creates only available adapters', () => {
    expect(listHarnessAdapters()).toEqual([
      { id: 'claude-code', available: true },
      { id: 'codex', available: false },
      { id: 'cherry-studio', available: false },
    ])
    expect(
      createHarnessAdapter('claude-code', {
        async *stream() {
          yield 'ok'
        },
      })
    ).toBeInstanceOf(ClaudeCodeAdapter)
    expect(() => createHarnessAdapter('codex')).toThrow(/codex.*not available/i)
    expect(() => createHarnessAdapter('missing')).toThrow(/claude-code, codex, cherry-studio/)
  })
})

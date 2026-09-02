import { describe, expect, it } from 'vitest'
import { ClaudeCodeAdapter } from '../../src/harness-adapter/claude-code-adapter.js'
import { createHarnessAdapter, listHarnessAdapters } from '../../src/harness-adapter/registry.js'

describe('Harness Integration Contract registry', () => {
  it('does not report an adapter runtime ready without a runnable provider', () => {
    expect(listHarnessAdapters().map(({ id, available }) => ({ id, available }))).toEqual([
      { id: 'claude-code', available: false },
      { id: 'codex', available: false },
      { id: 'cherry-studio', available: false },
    ])
  })

  it('lists static scaffold capabilities separately from availability', () => {
    expect(listHarnessAdapters()).toEqual([
      {
        id: 'claude-code',
        available: false,
        capabilities: {
          structuredOutput: true,
          interruption: true,
          overlay: true,
          streaming: true,
        },
      },
      {
        id: 'codex',
        available: false,
        capabilities: {
          structuredOutput: false,
          interruption: false,
          overlay: false,
          streaming: false,
        },
      },
      {
        id: 'cherry-studio',
        available: false,
        capabilities: {
          structuredOutput: false,
          interruption: false,
          overlay: false,
          streaming: false,
        },
      },
    ])
  })

  it('lists stable ids and supports injected test construction', () => {
    expect(listHarnessAdapters().map(({ id, available }) => ({ id, available }))).toEqual([
      { id: 'claude-code', available: false },
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
    expect(() => createHarnessAdapter('codex')).toThrow(
      /Harness Integration Contract boundary codex.*not available/i
    )
    expect(() => createHarnessAdapter('missing')).toThrow(
      /Unknown Harness Integration Contract boundary.*claude-code, codex, cherry-studio/i
    )
  })
})

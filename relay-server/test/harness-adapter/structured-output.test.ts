import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseStructuredOutput } from '../../src/harness-adapter/structured-output.js'

afterEach(() => vi.restoreAllMocks())

describe('parseStructuredOutput', () => {
  it('defaults omitted text format to plain', () => {
    const output = parseStructuredOutput(
      JSON.stringify({
        speech: { content: 'Short answer.' },
        text: { content: 'Detailed answer.' },
      })
    )

    expect(output.text).toEqual({ content: 'Detailed answer.', format: 'plain' })
  })

  it('normalizes invalid text format with a warning', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const output = parseStructuredOutput(
      JSON.stringify({
        speech: { content: 'Short answer.' },
        text: { content: 'Detailed answer.', format: 'rich' },
      })
    )

    expect(output.text).toEqual({ content: 'Detailed answer.', format: 'plain' })
    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning).toHaveBeenCalledWith(
      expect.stringMatching(/^\[.+\]$/),
      expect.stringContaining('unsupported text format')
    )
  })
})

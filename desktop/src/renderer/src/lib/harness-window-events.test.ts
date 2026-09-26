import { describe, expect, it } from 'vitest'
import { projectHarnessWindowEvent } from './harness-window-events.js'

describe('Harness window events', () => {
  it('projects public screen output into the window transcript', () => {
    expect(
      projectHarnessWindowEvent({
        type: 'harness.semantic-output',
        classification: 'public-screen',
        text: 'Simulated window answer.',
      })
    ).toEqual({ kind: 'text', text: 'Simulated window answer.' })
  })

  it('projects screen highlight events into a visible marker', () => {
    expect(
      projectHarnessWindowEvent({
        type: 'screen.highlight',
        target: 'result',
        mode: 'highlight',
      })
    ).toEqual({ kind: 'marker', target: 'result', mode: 'highlight' })
  })

  it('ignores private or malformed events', () => {
    expect(
      projectHarnessWindowEvent({
        type: 'harness.semantic-output',
        classification: 'private',
        text: 'hidden',
      })
    ).toBeNull()
    expect(projectHarnessWindowEvent({ type: 'screen.highlight', target: 42 })).toBeNull()
  })
})

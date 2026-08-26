import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TurnTracer } from '../../src/tracing/turn-tracer.js'

const exporter = vi.hoisted(() => ({
  updates: [] as unknown[],
  attributes: [] as unknown[],
}))

vi.mock('../../src/tracing/langfuse.js', () => ({
  isLangfuseEnabled: () => true,
}))

vi.mock('@langfuse/tracing', () => ({
  propagateAttributes: (_attributes: unknown, callback: () => void) => callback(),
  startObservation: () => ({
    update: (value: unknown) => exporter.updates.push(value),
    end: () => {},
    startObservation: () => ({
      update: () => {},
      end: () => {},
    }),
    otelSpan: {
      setAttributes: (value: unknown) => exporter.attributes.push(value),
    },
  }),
}))

describe('TurnTracer structured metadata', () => {
  beforeEach(() => {
    exporter.updates.length = 0
    exporter.attributes.length = 0
  })

  it('attaches thinking metadata', () => {
    const tracer = activeTracer()

    tracer.attachThinking({
      steps: ['inspect', 'verify'],
      reasoning: 'The fixture demonstrates the mapping',
      confidence: 0.8,
    })

    expect(exporter.updates).toContainEqual({
      metadata: {
        'thinking.steps': ['inspect', 'verify'],
        'thinking.reasoning': 'The fixture demonstrates the mapping',
        'thinking.confidence': 0.8,
      },
    })
  })

  it('attaches screen references', () => {
    const tracer = activeTracer()
    const references = [
      { at: 4, type: 'look' as const, target: 'results' },
      { at: 18, type: 'highlight' as const, target: 'details' },
    ]

    tracer.attachScreenReferences(references)

    expect(exporter.updates).toContainEqual({
      metadata: {
        'screen.references': JSON.stringify(references),
      },
    })
  })
})

function activeTracer(): TurnTracer {
  const tracer = new TurnTracer()
  tracer.startSession('session-1', 'user-1', 'model-1')
  tracer.startTurn()
  tracer.appendUserText('Find the issue')
  return tracer
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps thinking content out of traces by default', () => {
    vi.stubEnv('VOICECLAW_THINKING_CAPTURE', 'disabled')
    vi.stubEnv('VOICECLAW_TRACE_CONTENT', 'disabled')
    const tracer = activeTracer()

    tracer.attachThinking({
      steps: ['inspect', 'verify'],
      reasoning: 'private detail',
      confidence: 0.8,
    })

    expect(exporter.updates).toContainEqual({
      metadata: {
        'thinking.present': true,
        'thinking.size_bytes': 76,
        'thinking.classification': 'private',
        'thinking.capture_enabled': false,
      },
    })
  })

  it('redacts explicitly enabled thinking trace content', () => {
    vi.stubEnv('VOICECLAW_THINKING_CAPTURE', 'enabled')
    vi.stubEnv('VOICECLAW_TRACE_CONTENT', 'enabled')
    const tracer = activeTracer()

    tracer.attachThinking(
      {
        steps: ['inspect stt-secret', 'call harness-secret'],
        reasoning: 'tts-secret remains private while ordinary detail remains readable',
        confidence: 0.8,
      },
      undefined,
      [{ apiKey: 'stt-secret' }, { authToken: 'harness-secret' }, { token: 'tts-secret' }]
    )

    expect(exporter.updates).toContainEqual({
      metadata: expect.objectContaining({
        'thinking.steps': ['inspect [REDACTED]', 'call [REDACTED]'],
        'thinking.reasoning': '[REDACTED] remains private while ordinary detail remains readable',
        'thinking.confidence': 0.8,
      }),
    })
  })

  it('attaches safe thinking metadata', () => {
    vi.stubEnv('VOICECLAW_THINKING_CAPTURE', 'disabled')
    const tracer = activeTracer()

    tracer.attachThinking({
      steps: ['inspect', 'verify'],
      reasoning: 'The fixture demonstrates the mapping',
      confidence: 0.8,
    })

    expect(exporter.updates).toContainEqual({
      metadata: {
        'thinking.present': true,
        'thinking.size_bytes': 98,
        'thinking.classification': 'private',
        'thinking.capture_enabled': false,
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

import { describe, expect, it } from 'vitest'
import * as graph from '../../src/plugin-kernel/dependency-graph.js'

describe('required Capability dependency graph', () => {
  it('orders compatible providers before consumers', () => {
    const resolveRequiredDependencyGraph = (graph as Record<string, unknown>)
      .resolveRequiredDependencyGraph as (input: unknown[]) => {
      activationOrder: string[]
      edges: Array<{ provider: string; consumer: string; contractId: string }>
      pending: Array<{ contributionId: string; reason: string }>
      cycles: string[][]
    }

    expect(typeof resolveRequiredDependencyGraph).toBe('function')
    if (!resolveRequiredDependencyGraph) return

    const result = resolveRequiredDependencyGraph([
      {
        packageId: 'voiceclaw-routing',
        id: 'routing',
        provides: [],
        requires: [
          { id: 'speech.stt', range: '^1.0.0' },
          { id: 'speech.tts', range: '>=1.0.0 <2.0.0' },
        ],
      },
      {
        packageId: 'voiceclaw-speech',
        id: 'tts',
        provides: [{ id: 'speech.tts', version: '1.2.0' }],
        requires: [],
      },
      {
        packageId: 'voiceclaw-speech',
        id: 'stt',
        provides: [{ id: 'speech.stt', version: '1.0.0' }],
        requires: [],
      },
    ])

    expect(result.activationOrder).toEqual([
      'voiceclaw-speech:tts',
      'voiceclaw-speech:stt',
      'voiceclaw-routing:routing',
    ])
    expect(result.edges).toEqual([
      {
        provider: 'voiceclaw-speech:stt',
        consumer: 'voiceclaw-routing:routing',
        contractId: 'speech.stt',
      },
      {
        provider: 'voiceclaw-speech:tts',
        consumer: 'voiceclaw-routing:routing',
        contractId: 'speech.tts',
      },
    ])
    expect(result.pending).toEqual([])
    expect(result.cycles).toEqual([])
  })

  it('reports missing requirements and cycles without activating affected Contributions', () => {
    const resolveRequiredDependencyGraph = (graph as Record<string, unknown>)
      .resolveRequiredDependencyGraph as (input: unknown[]) => {
      activationOrder: string[]
      pending: Array<{ contributionId: string; reason: string }>
      cycles: string[][]
    }

    const result = resolveRequiredDependencyGraph([
      {
        packageId: 'voiceclaw-missing',
        id: 'missing',
        provides: [],
        requires: [{ id: 'archive.read', range: '^1.0.0' }],
      },
      {
        packageId: 'voiceclaw-cycle',
        id: 'alpha',
        provides: [{ id: 'alpha', version: '1.0.0' }],
        requires: [{ id: 'beta', range: '^1.0.0' }],
      },
      {
        packageId: 'voiceclaw-cycle',
        id: 'beta',
        provides: [{ id: 'beta', version: '1.0.0' }],
        requires: [{ id: 'alpha', range: '^1.0.0' }],
      },
      {
        packageId: 'voiceclaw-cycle-consumer',
        id: 'gamma',
        provides: [],
        requires: [{ id: 'alpha', range: '^1.0.0' }],
      },
      { packageId: 'voiceclaw-base', id: 'independent', provides: [], requires: [] },
    ])

    expect(result.activationOrder).toEqual(['voiceclaw-base:independent'])
    expect(result.pending).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contributionId: 'voiceclaw-missing:missing',
          reason: expect.stringContaining('archive.read'),
        }),
        expect.objectContaining({
          contributionId: 'voiceclaw-cycle:alpha',
          reason: expect.stringContaining('cycle'),
        }),
        expect.objectContaining({
          contributionId: 'voiceclaw-cycle:beta',
          reason: expect.stringContaining('cycle'),
        }),
        expect.objectContaining({
          contributionId: 'voiceclaw-cycle-consumer:gamma',
          reason: expect.stringContaining('pending'),
        }),
      ])
    )
    expect(result.cycles).toEqual([
      ['voiceclaw-cycle:alpha', 'voiceclaw-cycle:beta', 'voiceclaw-cycle:alpha'],
    ])
  })

  it('uses SemVer precedence for zero-major caret and prerelease ranges', () => {
    expect(graph.versionSatisfies('0.2.0', '^0.1.0')).toBe(false)
    expect(graph.versionSatisfies('0.1.9', '^0.1.0')).toBe(true)
    expect(graph.versionSatisfies('1.0.0-alpha', '>=1.0.0')).toBe(false)
    expect(graph.versionSatisfies('1.1.0-alpha', '>=1.0.0-alpha <2.0.0')).toBe(false)
  })
})

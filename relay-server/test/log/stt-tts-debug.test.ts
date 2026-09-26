import { describe, expect, it, vi } from 'vitest'
import { createSttTtsDebugRecorder } from '../../src/stt-tts-debug.js'

describe('STT/TTS debug recorder', () => {
  it('is disabled unless activation is exactly true', () => {
    for (const activation of [undefined, '', '1', 'TRUE', 'false']) {
      const sink = vi.fn()
      const recorder = createSttTtsDebugRecorder({ activation, sink })
      recorder.record('session.connect.start', { sessionId: 'session-1', stage: 'session' })
      expect(sink).not.toHaveBeenCalled()
    }

    const sink = vi.fn()
    createSttTtsDebugRecorder({ activation: 'true', sink }).record('session.connect.start', {
      sessionId: 'session-1',
      stage: 'session',
    })
    expect(sink).toHaveBeenCalledOnce()
  })

  it('writes one stable JSON line containing only approved fields', () => {
    const lines: string[] = []
    const recorder = createSttTtsDebugRecorder({
      activation: 'true',
      now: () => new Date('2026-09-13T12:34:56.000Z'),
      sink: (line) => lines.push(line),
    })

    recorder.record('stt.recognition.complete', {
      sessionId: 'session-1',
      turnId: 'turn-1',
      stage: 'stt',
      providerId: 'gpt-sovits-stt',
      transcriptText: '完整\n转写',
      transcriptCharacters: 5,
      apiKey: 'must-not-appear',
      audio: 'base64-audio',
    } as never)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^\[stt-tts-debug\] \{.*\}$/)
    const record = JSON.parse(lines[0].slice('[stt-tts-debug] '.length))
    expect(record).toEqual({
      marker: 'stt-tts-debug',
      timestamp: '2026-09-13T12:34:56.000Z',
      event: 'stt.recognition.complete',
      sessionId: 'session-1',
      turnId: 'turn-1',
      stage: 'stt',
      providerId: 'gpt-sovits-stt',
      transcriptText: '完整\n转写',
      transcriptCharacters: 5,
    })
  })

  it('never throws when serialization or the sink fails', () => {
    const recorder = createSttTtsDebugRecorder({
      activation: 'true',
      sink: () => {
        throw new Error('disk full')
      },
    })

    expect(() =>
      recorder.record('session.connect.failed', {
        sessionId: 'session-1',
        stage: 'session',
        error: 'connect failed',
      })
    ).not.toThrow()
  })
})

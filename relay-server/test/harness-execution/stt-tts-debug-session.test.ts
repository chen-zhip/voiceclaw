import { describe, expect, it, vi } from 'vitest'
import type { HarnessExecutionEvent } from '@voiceclaw/contracts'
import type {
  AcceptedHarnessAttempt,
  HarnessRoutingPort,
} from '../../src/harness-execution/dispatch.js'
import { HarnessAttemptSession } from '../../src/harness-execution/session-routing.js'
import { createSttTtsDebugRecorder } from '../../src/stt-tts-debug.js'

const binding = {
  bindingId: 'binding-1',
  providerId: 'codex-provider',
  workspaceBindingId: 'workspace-1',
  generation: 3,
}

describe('STT/TTS Harness session diagnostics', () => {
  it('reports dispatch public speech rejection and terminal outcome without raw payloads', async () => {
    const lines: string[] = []
    const accepted = attempt([
      event(1, 'semantic-output', {
        audience: 'public',
        channel: 'speech',
        text: 'Public answer.',
      }),
      event(2, 'terminal', { outcome: 'completed' }),
    ])
    const completeAttempt = vi.fn().mockResolvedValue(undefined)
    const session = createSession(routing({ accepted, completeAttempt }), lines)

    await expect(session.accept('session-1', 'recognized text', binding)).resolves.toBe(
      'dispatched'
    )
    await vi.waitFor(() => expect(completeAttempt).toHaveBeenCalled())

    expect(lines.map(parseRecord)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'harness.dispatch.start',
          sessionId: 'session-1',
          providerId: 'codex-provider',
        }),
        expect.objectContaining({
          event: 'harness.dispatch.complete',
          turnId: 'turn-1',
          attemptId: 'attempt-1',
        }),
        expect.objectContaining({
          event: 'harness.speech.received',
          turnId: 'turn-1',
          sequence: 1,
          speechCharacters: 14,
        }),
        expect.objectContaining({
          event: 'harness.terminal',
          turnId: 'turn-1',
          outcome: 'completed',
        }),
      ])
    )

    const rejectedLines: string[] = []
    const rejectedComplete = vi.fn().mockResolvedValue(undefined)
    const rejectedSession = createSession(
      routing({
        accepted: attempt([
          event(1, 'private-reasoning', { text: 'hidden chain of thought' }),
          event(2, 'terminal', { outcome: 'completed' }),
        ]),
        completeAttempt: rejectedComplete,
      }),
      rejectedLines
    )
    await rejectedSession.accept('session-2', 'recognized text', binding)
    await vi.waitFor(() => expect(rejectedComplete).toHaveBeenCalled())
    expect(rejectedLines.map(parseRecord)).toContainEqual(
      expect.objectContaining({ event: 'harness.stream.rejected', sequence: 1 })
    )
    expect(rejectedLines.join('\n')).not.toContain('hidden chain of thought')
  })

  it('reports queued and failed dispatch outcomes', async () => {
    const queuedLines: string[] = []
    const queued = createSession(
      {
        acceptTranscript: async () => ({ status: 'queued', turnId: 'turn-queued' }),
        completeAttempt: async () => undefined,
        cancelController: () => ({ cancel: async () => ({ accepted: false, code: 'none' }) }),
      } as HarnessRoutingPort,
      queuedLines
    )
    await expect(queued.accept('session-queued', 'text', binding)).resolves.toBe('queued')
    expect(queuedLines.map(parseRecord)).toContainEqual(
      expect.objectContaining({ event: 'harness.dispatch.queued', turnId: 'turn-queued' })
    )

    const failedLines: string[] = []
    const failed = createSession(
      {
        acceptTranscript: async () => {
          throw new Error('Host unavailable')
        },
        completeAttempt: async () => undefined,
        cancelController: () => ({ cancel: async () => ({ accepted: false, code: 'none' }) }),
      } as HarnessRoutingPort,
      failedLines
    )
    await expect(failed.accept('session-failed', 'text', binding)).rejects.toThrow(
      'Host unavailable'
    )
    expect(failedLines.map(parseRecord)).toContainEqual(
      expect.objectContaining({ event: 'harness.failed', error: 'Host unavailable' })
    )
  })

  it('reports accepted cancellation with authoritative identity', async () => {
    const lines: string[] = []
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const accepted = attempt([
      event(1, 'semantic-output', {
        audience: 'public',
        channel: 'speech',
        text: 'Slow answer.',
      }),
      event(2, 'terminal', { outcome: 'completed' }),
    ])
    const port = routing({ accepted, completeAttempt: vi.fn().mockResolvedValue(undefined) })
    port.cancelController = () =>
      ({
        cancel: async () => ({ accepted: true as const }),
      }) as never
    const session = createSession(port, lines, gate)

    await session.accept('session-cancel', 'text', binding)
    await expect(session.cancel('user requested cancellation')).resolves.toEqual({ accepted: true })
    release()

    expect(lines.map(parseRecord)).toContainEqual(
      expect.objectContaining({
        event: 'harness.cancelled',
        sessionId: 'session-cancel',
        turnId: 'turn-1',
        attemptId: 'attempt-1',
        reason: 'user requested cancellation',
      })
    )
  })
})

function createSession(routingPort: HarnessRoutingPort, lines: string[], gate?: Promise<void>) {
  return new HarnessAttemptSession({
    routing: routingPort,
    tts: {
      async *synthesize() {
        if (gate) await gate
        yield { data: 'YXVkaW8=' }
      },
      getPlaybackPosition: () => 0,
    } as never,
    sendToClient: () => {},
    cancelPrincipal: { kind: 'user', id: 'owner' },
    debugRecorder: createSttTtsDebugRecorder({
      activation: 'true',
      sink: (line) => lines.push(line),
    }),
  })
}

function routing(input: {
  accepted: AcceptedHarnessAttempt
  completeAttempt: ReturnType<typeof vi.fn>
}): HarnessRoutingPort {
  return {
    acceptTranscript: async () => ({ status: 'dispatched', accepted: input.accepted }),
    completeAttempt: input.completeAttempt,
    cancelController: () => ({ cancel: async () => ({ accepted: false, code: 'none' }) }) as never,
  }
}

function attempt(events: HarnessExecutionEvent[]): AcceptedHarnessAttempt {
  return {
    conversationId: 'session-1',
    turnId: 'turn-1',
    attemptId: 'attempt-1',
    identity: {
      invocationId: 'invocation-1',
      bindingId: binding.bindingId,
      threadId: 'thread-1',
      turnId: 'turn-1',
      attemptId: 'attempt-1',
      generation: binding.generation,
    },
    binding,
    events,
  }
}

function event(
  sequence: number,
  kind: HarnessExecutionEvent['kind'],
  payload: Record<string, unknown>
): HarnessExecutionEvent {
  return {
    invocationId: 'invocation-1',
    bindingId: binding.bindingId,
    threadId: 'thread-1',
    turnId: 'turn-1',
    attemptId: 'attempt-1',
    generation: binding.generation,
    sequence,
    kind,
    payload,
  } as HarnessExecutionEvent
}

function parseRecord(line: string): Record<string, unknown> {
  return JSON.parse(line.slice('[stt-tts-debug] '.length))
}

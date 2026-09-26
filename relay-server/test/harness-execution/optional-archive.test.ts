import type { HarnessExecutionEvent } from '@voiceclaw/contracts'
import { describe, expect, it, vi } from 'vitest'
import { HarnessStreamRouter } from '../../src/harness-execution/stream-routing.js'

const identity = {
  invocationId: 'invocation-1',
  bindingId: 'binding-1',
  threadId: 'thread-1',
  turnId: 'turn-1',
  attemptId: 'attempt-1',
  generation: 1,
}

describe('optional Archive routing', () => {
  it('runs without an Archive provider', async () => {
    const archiveModule = await import('../../src/harness-execution/optional-archive.js').catch(
      () => ({})
    )
    const OptionalArchiveConsumer = Reflect.get(archiveModule, 'OptionalArchiveConsumer')

    expect(OptionalArchiveConsumer).toBeTypeOf('function')

    const archiveInvoke = vi.fn().mockResolvedValue({ accepted: true })
    const absentArchive = new OptionalArchiveConsumer({
      workspaceBindingId: 'workspace-1',
      resolveProvider: () => undefined,
      authorize: () => false,
    })
    const speech = vi.fn().mockResolvedValue(undefined)
    const clientEvents: unknown[] = []
    const router = new HarnessStreamRouter({
      activeAttempt: identity,
      speech: { write: speech },
      sendToClient: (event) => clientEvents.push(event),
      acceptedEventConsumers: [(event) => absentArchive.accept(event)],
    })

    await router.route(streamEvent(1, 'semantic-output', publicSpeech('Live answer.')))
    await router.route(streamEvent(2, 'terminal', { outcome: 'completed' }))

    expect(speech).toHaveBeenCalledWith('Live answer.')
    expect(clientEvents.at(-1)).toMatchObject({
      type: 'harness.terminal',
      outcome: { outcome: 'completed' },
    })
    expect(absentArchive.status()).toEqual({
      availability: 'absent',
      persistence: 'session-only',
    })
    expect(archiveInvoke).not.toHaveBeenCalled()

    const provider = {
      contract: { id: 'archive.append', version: '1.0.0' },
      invoke: archiveInvoke,
    }
    const unauthorized = new OptionalArchiveConsumer({
      workspaceBindingId: 'workspace-1',
      resolveProvider: () => provider,
      authorize: () => false,
    })
    await unauthorized.accept(streamEvent(1, 'semantic-output', publicSpeech('Not granted')))
    expect(archiveInvoke).not.toHaveBeenCalled()

    const authorized = new OptionalArchiveConsumer({
      workspaceBindingId: 'workspace-1',
      resolveProvider: () => provider,
      authorize: (request: unknown) => {
        expect(request).toEqual({
          principalId: 'routing',
          contractId: 'archive.append',
          operation: 'append',
          scope: { kind: 'workspace', id: 'workspace-1' },
          workspaceBindingId: 'workspace-1',
        })
        return true
      },
    })
    const visibleEvent = streamEvent(1, 'semantic-output', publicSpeech('Persist me'))
    await authorized.accept(visibleEvent)
    expect(archiveInvoke).toHaveBeenCalledWith('archive.append', visibleEvent)
  })

  it('keeps the Turn when Archive append fails', async () => {
    const { OptionalArchiveConsumer } =
      await import('../../src/harness-execution/optional-archive.js')
    const cases = [
      {
        reason: 'rejected',
        invoke: vi.fn().mockRejectedValue(new Error('append rejected')),
      },
      {
        reason: 'timeout',
        invoke: vi.fn(() => new Promise(() => {})),
      },
      {
        reason: 'disconnected',
        invoke: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error('socket closed'), { code: 'disconnected' })),
      },
    ]

    for (const [index, failure] of cases.entries()) {
      const projected: unknown[] = []
      const clientEvents: unknown[] = []
      const consumer = new OptionalArchiveConsumer({
        workspaceBindingId: 'workspace-1',
        resolveProvider: () => ({
          contract: { id: 'archive.append', version: '1.0.0' },
          invoke: failure.invoke,
        }),
        authorize: () => true,
        timeoutMs: 5,
        projectStatus: (status: unknown) => projected.push(status),
      })
      const activeAttempt = { ...identity, invocationId: `invocation-${index + 2}` }
      const router = new HarnessStreamRouter({
        activeAttempt,
        speech: { write: vi.fn().mockResolvedValue(undefined) },
        sendToClient: (event) => clientEvents.push(event),
        acceptedEventConsumers: [(event) => consumer.accept(event)],
      })

      await expect(
        router.route({
          ...activeAttempt,
          sequence: 1,
          kind: 'semantic-output',
          payload: { audience: 'public', channel: 'screen', text: 'Public answer' },
        })
      ).resolves.toEqual({ accepted: true })
      await expect(
        router.route({
          ...activeAttempt,
          sequence: 2,
          kind: 'terminal',
          payload: { outcome: 'completed' },
        })
      ).resolves.toEqual({ accepted: true })

      expect(failure.invoke).toHaveBeenCalledOnce()
      expect(projected).toEqual([
        {
          availability: 'degraded',
          persistence: 'session-only',
          reason: failure.reason,
        },
      ])
      expect(consumer.status()).toEqual(projected[0])
      expect(clientEvents).toEqual([
        {
          type: 'harness.semantic-output',
          classification: 'public-screen',
          text: 'Public answer',
        },
        {
          type: 'harness.terminal',
          classification: 'terminal',
          outcome: { outcome: 'completed' },
        },
      ])
    }
  })
})

function streamEvent(
  sequence: number,
  kind: HarnessExecutionEvent['kind'],
  payload: Record<string, unknown>
): HarnessExecutionEvent {
  return { ...identity, sequence, kind, payload }
}

function publicSpeech(text: string): Record<string, unknown> {
  return { audience: 'public', channel: 'speech', text }
}

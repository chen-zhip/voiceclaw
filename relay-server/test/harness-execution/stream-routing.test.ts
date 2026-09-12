import type { HarnessExecutionEvent } from '@voiceclaw/contracts'
import { describe, expect, it, vi } from 'vitest'

describe('Harness public stream routing', () => {
  it('routes classified public output', async () => {
    const routingModule = await import('../../src/harness-execution/stream-routing.js').catch(
      () => ({})
    )
    const HarnessStreamRouter = Reflect.get(routingModule, 'HarnessStreamRouter')

    expect(HarnessStreamRouter).toBeTypeOf('function')

    const speak = vi.fn().mockResolvedValue(undefined)
    const clientEvents: unknown[] = []
    const router = new HarnessStreamRouter({
      activeAttempt: identity,
      speech: { write: speak },
      sendToClient: (event: unknown) => clientEvents.push(event),
    })
    const terminalPayload = { outcome: 'completed' }

    await router.route(
      event(1, 'semantic-output', { audience: 'public', channel: 'speech', text: 'Spoken answer.' })
    )
    await router.route(
      event(2, 'semantic-output', {
        audience: 'public',
        channel: 'screen',
        text: 'Detailed answer',
      })
    )
    await router.route(event(3, 'presentation-state', { phase: 'executing', label: 'Working' }))
    await router.route(event(4, 'outcome-evidence', { operation: 'test', status: 'passed' }))
    await router.route(event(5, 'terminal', terminalPayload))

    expect(speak).toHaveBeenCalledWith('Spoken answer.')
    expect(clientEvents).toEqual([
      {
        type: 'harness.semantic-output',
        classification: 'public-screen',
        text: 'Detailed answer',
      },
      {
        type: 'harness.presentation-state',
        classification: 'presentation-state',
        state: { phase: 'executing', label: 'Working' },
      },
      {
        type: 'harness.outcome-evidence',
        classification: 'outcome-evidence',
        evidence: { operation: 'test', status: 'passed' },
      },
      {
        type: 'harness.terminal',
        classification: 'terminal',
        outcome: terminalPayload,
      },
    ])
  })

  it('rejects private or invalid stream events', async () => {
    const { HarnessStreamRouter } = await import('../../src/harness-execution/stream-routing.js')
    const speak = vi.fn().mockResolvedValue(undefined)
    const sendToClient = vi.fn()
    const archive = vi.fn()
    const memory = vi.fn()
    const plugin = vi.fn()
    const router = new HarnessStreamRouter({
      activeAttempt: identity,
      speech: { write: speak },
      sendToClient,
      acceptedEventConsumers: [archive, memory, plugin],
    })

    const rejected = [
      event(1, 'semantic-output', {
        audience: 'public',
        channel: 'speech',
        text: 'Do not speak private material',
        rawReasoning: 'private chain',
      }),
      { ...event(1, 'semantic-output', publicScreen('wrong attempt')), attemptId: 'attempt-old' },
      { ...event(1, 'semantic-output', publicScreen('stale host')), generation: 2 },
    ]
    for (const candidate of rejected) {
      await expect(router.route(candidate)).resolves.toMatchObject({ accepted: false })
    }

    await expect(
      router.route(event(1, 'semantic-output', publicScreen('Accepted once')))
    ).resolves.toEqual({ accepted: true })
    expect(plugin).toHaveBeenCalledOnce()
    vi.clearAllMocks()

    for (const candidate of [
      event(1, 'semantic-output', publicScreen('duplicate')),
      event(3, 'semantic-output', publicScreen('out of order')),
    ]) {
      await expect(router.route(candidate)).resolves.toMatchObject({ accepted: false })
    }

    await expect(router.route(event(2, 'terminal', { outcome: 'completed' }))).resolves.toEqual({
      accepted: true,
    })
    vi.clearAllMocks()
    for (const candidate of [
      event(3, 'semantic-output', publicScreen('too late')),
      event(3, 'terminal', { outcome: 'failed' }),
    ]) {
      await expect(router.route(candidate)).resolves.toMatchObject({ accepted: false })
    }

    expect(speak).not.toHaveBeenCalled()
    expect(sendToClient).not.toHaveBeenCalled()
    expect(archive).not.toHaveBeenCalled()
    expect(memory).not.toHaveBeenCalled()
    expect(plugin).not.toHaveBeenCalled()
  })
})

const identity = {
  invocationId: 'invocation-1',
  bindingId: 'binding-1',
  threadId: 'thread-1',
  turnId: 'turn-1',
  attemptId: 'attempt-1',
  generation: 3,
}

function publicScreen(text: string): Record<string, unknown> {
  return { audience: 'public', channel: 'screen', text }
}

function event(
  sequence: number,
  kind: HarnessExecutionEvent['kind'],
  payload: Record<string, unknown>
): HarnessExecutionEvent {
  return {
    ...identity,
    sequence,
    kind,
    payload,
  }
}

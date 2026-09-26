import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ConversationRouting } from '../../src/harness-execution/conversation-routing.js'
import { createProductionHarnessRouting } from '../../src/harness-execution/production-routing.js'
import { HarnessAttemptSession } from '../../src/harness-execution/session-routing.js'
import { ConversationThreadMappings } from '../../src/harness-execution/thread-mapping.js'
import { ControlStateStore } from '../../src/plugin-kernel/control-state-store.js'

const binding = {
  bindingId: 'binding-fixture',
  providerId: 'fixture-provider',
  workspaceBindingId: 'workspace-fixture',
  generation: 7,
}

describe('Production Harness routing', () => {
  it('routes Host stream events to TTS, Client, and one terminal Attempt outcome', async () => {
    const harness = await startHarness({
      events: [
        streamEvent(1, 'semantic-output', {
          audience: 'public',
          channel: 'speech',
          text: 'Fixture answer.',
        }),
        streamEvent(2, 'semantic-output', {
          audience: 'public',
          channel: 'screen',
          text: 'Fixture details',
        }),
        streamEvent(3, 'terminal', { outcome: 'completed' }),
      ],
    })

    await expect(
      harness.session.accept('conversation-fixture', 'Final microphone text', binding)
    ).resolves.toBe('dispatched')
    await vi.waitFor(() => expect(harness.spoken).toContain('Fixture answer.'))
    await vi.waitFor(() =>
      expect(harness.clientEvents).toContainEqual({
        type: 'harness.terminal',
        classification: 'terminal',
        outcome: { outcome: 'completed' },
      })
    )

    expect(harness.clientEvents).toContainEqual({
      type: 'harness.semantic-output',
      classification: 'public-screen',
      text: 'Fixture details',
    })
    expect(harness.routing.inspect('conversation-fixture').active).toBeNull()
    harness.releaseSynthesis()
  })

  it('rejects private reasoning instead of forwarding it to Client or TTS', async () => {
    const harness = await startHarness({
      events: [
        streamEvent(1, 'private-reasoning', { text: 'hidden chain of thought' }),
        streamEvent(2, 'terminal', { outcome: 'completed' }),
      ],
    })

    await harness.session.accept('conversation-fixture', 'Final microphone text', binding)
    await vi.waitFor(() =>
      expect(harness.routing.inspect('conversation-fixture').active).toBeNull()
    )

    expect(harness.spoken).toEqual([])
    expect(
      harness.clientEvents.some((event) =>
        JSON.stringify(event).includes('hidden chain of thought')
      )
    ).toBe(false)
    harness.releaseSynthesis()
  })

  it('queues a later input instead of failing while a Harness Turn is active', async () => {
    const harness = await startHarness({
      events: [
        streamEvent(1, 'semantic-output', {
          audience: 'public',
          channel: 'speech',
          text: 'Slow answer.',
        }),
        streamEvent(2, 'terminal', { outcome: 'completed' }),
      ],
      holdSynthesis: true,
    })

    await harness.session.accept('conversation-fixture', 'First input', binding)
    await expect(
      harness.session.accept('conversation-fixture', 'Second input', binding)
    ).resolves.toBe('queued')
    expect(harness.routing.inspect('conversation-fixture').backlog).toHaveLength(1)

    harness.releaseSynthesis()
    await vi.waitFor(() =>
      expect(harness.routing.inspect('conversation-fixture').active).toBeNull()
    )
  })

  it('cancels the active Attempt through turn.cancel', async () => {
    const harness = await startHarness({
      events: [
        streamEvent(1, 'semantic-output', {
          audience: 'public',
          channel: 'speech',
          text: 'Slow answer.',
        }),
        streamEvent(2, 'terminal', { outcome: 'completed' }),
      ],
      holdSynthesis: true,
    })

    await harness.session.accept('conversation-fixture', 'Cancellable input', binding)
    await expect(harness.session.cancel('user requested cancellation')).resolves.toEqual({
      accepted: true,
    })

    expect(harness.invoke.mock.calls.map(([envelope]) => envelope.operation)).toEqual([
      'thread.ensure',
      'turn.start',
      'turn.cancel',
    ])
    expect(harness.clientEvents).toContainEqual({
      type: 'harness.terminal',
      classification: 'terminal',
      outcome: { outcome: 'cancelled' },
    })

    harness.releaseSynthesis()
  })

  it('cancels a dispatched Turn while the Host is still executing turn.start', async () => {
    const harness = await startHarness({
      events: [streamEvent(1, 'terminal', { outcome: 'completed' })],
      holdStart: true,
    })

    const acceptance = harness.session.accept('conversation-fixture', 'Long input', binding)
    await vi.waitFor(() =>
      expect(harness.invoke.mock.calls.map(([envelope]) => envelope.operation)).toContain(
        'turn.start'
      )
    )

    await expect(harness.session.cancel('user requested cancellation')).resolves.toEqual({
      accepted: true,
    })
    expect(harness.invoke.mock.calls.map(([envelope]) => envelope.operation)).toContain(
      'turn.cancel'
    )
    expect(harness.clientEvents).toContainEqual({
      type: 'harness.terminal',
      classification: 'terminal',
      outcome: { outcome: 'cancelled' },
    })

    harness.releaseStart()
    await expect(acceptance).resolves.toBe('dispatched')
    expect(harness.clientEvents.filter((event) => event.type === 'harness.terminal')).toHaveLength(
      1
    )
    expect(harness.routing.inspect('conversation-fixture').active).toBeNull()
  })

  it('preserves cancellation when pending Host execution later rejects', async () => {
    const harness = await startHarness({ events: [], holdStart: true, rejectStart: true })
    const acceptance = harness.session.accept('conversation-fixture', 'Long input', binding)
    await vi.waitFor(() =>
      expect(harness.invoke.mock.calls.map(([envelope]) => envelope.operation)).toContain(
        'turn.start'
      )
    )
    await harness.session.cancel('user requested cancellation')
    harness.releaseStart()
    await expect(acceptance).resolves.toBe('dispatched')
    expect(harness.clientEvents.filter((event) => event.type === 'harness.terminal')).toEqual([
      { type: 'harness.terminal', classification: 'terminal', outcome: { outcome: 'cancelled' } },
    ])
    expect(harness.routing.inspect('conversation-fixture').active).toBeNull()
  })

  it('keeps the next Turn cancellable when a cancelled Host execution finishes late', async () => {
    const harness = await startHarness({
      events: [
        streamEvent(1, 'semantic-output', {
          audience: 'public',
          channel: 'speech',
          text: 'Next answer.',
        }),
        streamEvent(2, 'terminal', { outcome: 'completed' }),
      ],
      holdStart: true,
      holdSynthesis: true,
    })
    const first = harness.session.accept('conversation-fixture', 'First input', binding)
    await vi.waitFor(() =>
      expect(
        harness.invoke.mock.calls.filter(([envelope]) => envelope.operation === 'turn.start')
      ).toHaveLength(1)
    )
    await harness.session.cancel('cancel first')
    const next = harness.session.accept('conversation-fixture', 'Next input', binding)
    await vi.waitFor(() =>
      expect(
        harness.invoke.mock.calls.filter(([envelope]) => envelope.operation === 'turn.start')
      ).toHaveLength(2)
    )
    harness.releaseStart()
    await Promise.all([first, next])
    await expect(harness.session.cancel('cancel next')).resolves.toEqual({ accepted: true })
    harness.releaseSynthesis()
    expect(harness.clientEvents.filter((event) => event.type === 'harness.terminal')).toHaveLength(
      2
    )
  })

  it('reports a rejected cancellation without terminating the active Turn', async () => {
    const harness = await startHarness({ events: [], holdStart: true, rejectCancel: true })
    const acceptance = harness.session.accept('conversation-fixture', 'Input', binding)
    await vi.waitFor(() =>
      expect(harness.invoke.mock.calls.map(([envelope]) => envelope.operation)).toContain(
        'turn.start'
      )
    )
    await expect(harness.session.cancel('cancel')).resolves.toEqual({
      accepted: false,
      code: 'cancellation_failed',
    })
    expect(harness.clientEvents).toContainEqual({
      type: 'error',
      code: 409,
      message: 'Unable to cancel this turn. Check the provider thread before retrying.',
    })
    expect(harness.clientEvents.filter((event) => event.type === 'harness.terminal')).toEqual([])
    harness.releaseStart()
    await acceptance
  })

  it('refuses a binding that does not match the Active Host Assignment', async () => {
    const harness = await startHarness({ events: [] })

    await expect(
      harness.session.accept('conversation-fixture', 'Text', {
        ...binding,
        providerId: 'other-provider',
      })
    ).rejects.toThrow('Harness Host binding is unavailable')
  })

  it('can synthesize the next Turn after cancelling pending Host execution', async () => {
    const harness = await startHarness({
      events: [
        streamEvent(1, 'semantic-output', {
          audience: 'public',
          channel: 'speech',
          text: 'Next answer.',
        }),
        streamEvent(2, 'terminal', { outcome: 'completed' }),
      ],
      holdStart: true,
    })
    const first = harness.session.accept('conversation-fixture', 'First input', binding)
    await vi.waitFor(() =>
      expect(harness.invoke.mock.calls.map(([envelope]) => envelope.operation)).toContain(
        'turn.start'
      )
    )
    await harness.session.cancel('user requested cancellation')
    harness.releaseStart()
    await first

    await harness.session.accept('conversation-fixture', 'Next input', binding)
    await vi.waitFor(() => expect(harness.spoken).toEqual(['Next answer.']))
  })
})

async function startHarness(input: {
  events: unknown[]
  holdSynthesis?: boolean
  holdStart?: boolean
  rejectStart?: boolean
  rejectCancel?: boolean
}) {
  const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-production-routing-'))
  const store = await ControlStateStore.open(join(directory, 'control-state.json'), {
    requester: { kind: 'relay-authority', id: 'harness-routing-test' },
  })
  await store.commit((state) => ({
    ...state,
    assignments: [
      {
        bindingId: binding.bindingId,
        hostId: 'host-fixture',
        providerId: binding.providerId,
        workspaceBindingId: binding.workspaceBindingId,
        generation: binding.generation,
      },
    ],
  }))

  let releaseStart: () => void = () => {}
  const startGate = input.holdStart
    ? new Promise<void>((resolve) => {
        releaseStart = resolve
      })
    : undefined
  const invoke = vi.fn(
    async (
      envelope: { operation: string; invocationId: string },
      payload: { turnId: string; attemptId: string }
    ) => {
      if (envelope.operation === 'thread.ensure') return { result: { threadId: 'thread-fixture' } }
      if (envelope.operation === 'turn.cancel' && input.rejectCancel)
        throw new Error('Host unavailable')
      if (envelope.operation === 'turn.start' && startGate) await startGate
      if (envelope.operation === 'turn.start' && input.rejectStart)
        throw new Error('Host execution cancelled')
      return {
        events: input.events.map((event) => ({
          ...(event as Record<string, unknown>),
          invocationId: envelope.invocationId,
          turnId: payload.turnId,
          attemptId: payload.attemptId,
        })),
      }
    }
  )

  const routing = new ConversationRouting({
    createTurnId: sequence('turn'),
    createAttemptId: sequence('attempt'),
  })
  const port = createProductionHarnessRouting({
    kernel: { invoke },
    controlState: store,
    routing,
    mappings: new ConversationThreadMappings(store),
    selectedContribution: {
      packageId: 'voiceclaw-provider-fixture',
      contributionId: 'fixture-host',
    },
    createInvocationId: sequence('invocation'),
    createTraceId: sequence('trace'),
  })

  let releaseSynthesis: () => void = () => {}
  const synthesisGate = input.holdSynthesis
    ? new Promise<void>((resolve) => {
        releaseSynthesis = resolve
      })
    : undefined
  const spoken: string[] = []
  const clientEvents: Array<Record<string, unknown>> = []
  const session = new HarnessAttemptSession({
    routing: port,
    tts: {
      async *synthesize(text: string) {
        if (synthesisGate) await synthesisGate
        spoken.push(text)
        yield { data: `audio:${text}` }
      },
      getPlaybackPosition: () => 0,
    } as never,
    sendToClient: (event) => clientEvents.push(event as Record<string, unknown>),
    cancelPrincipal: { kind: 'user', id: 'relay-owner' },
  })

  return {
    invoke,
    routing,
    session,
    clientEvents,
    spoken,
    releaseSynthesis: () => releaseSynthesis(),
    releaseStart: () => releaseStart(),
  }
}

function streamEvent(sequence: number, kind: string, payload: Record<string, unknown>) {
  return {
    invocationId: 'pending',
    bindingId: binding.bindingId,
    threadId: 'thread-fixture',
    turnId: 'turn-fixture',
    attemptId: 'attempt-fixture',
    generation: binding.generation,
    sequence,
    kind,
    payload,
  }
}

function sequence(prefix: string): () => string {
  let value = 0
  return () => `${prefix}-${++value}`
}

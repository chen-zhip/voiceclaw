import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ConversationRouting } from '../../src/harness-execution/conversation-routing.js'
import { createProductionHarnessRouting } from '../../src/harness-execution/production-routing.js'
import { HarnessAttemptSession } from '../../src/harness-execution/session-routing.js'
import { ConversationThreadMappings } from '../../src/harness-execution/thread-mapping.js'
import { OptionalArchiveConsumer } from '../../src/harness-execution/optional-archive.js'
import { OptionalMemoryConsumer } from '../../src/harness-execution/optional-memory.js'
import { ControlStateStore } from '../../src/plugin-kernel/control-state-store.js'

describe('STT/TTS Harness Routing acceptance', () => {
  it('completes the deterministic provider-neutral Desktop route through the production path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-routing-acceptance-'))
    const store = await ControlStateStore.open(join(directory, 'control-state.json'), {
      requester: { kind: 'relay-authority', id: 'routing' },
    })
    await store.commit((state) => ({
      ...state,
      assignments: [
        {
          bindingId: 'binding-fixture',
          hostId: 'host-fixture',
          providerId: 'fixture-provider',
          workspaceBindingId: 'workspace-fixture',
          generation: 1,
        },
      ],
    }))
    const speech: string[] = []
    const clientEvents: unknown[] = []
    const invoke = vi.fn(
      async (
        envelope: { operation: string; invocationId: string },
        payload: { turnId: string; attemptId: string }
      ) => {
        if (envelope.operation === 'thread.ensure') {
          return { result: { threadId: 'thread-fixture' } }
        }
        return {
          events: [
            event(envelope.invocationId, payload, 1, 'semantic-output', {
              audience: 'public',
              channel: 'speech',
              text: 'Fixture answer.',
            }),
            event(envelope.invocationId, payload, 2, 'semantic-output', {
              audience: 'public',
              channel: 'screen',
              text: 'Fixture details',
            }),
            event(envelope.invocationId, payload, 3, 'terminal', { outcome: 'completed' }),
          ],
        }
      }
    )
    const tts = {
      async *synthesize(text: string) {
        speech.push(text)
        yield { data: `audio:${text}` }
      },
      getPlaybackPosition: () => 0,
    }
    const routing = new ConversationRouting({
      createTurnId: () => 'turn-fixture',
      createAttemptId: () => 'attempt-fixture',
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
    const session = new HarnessAttemptSession({
      routing: port,
      tts: tts as never,
      sendToClient: (event) => clientEvents.push(event),
      cancelPrincipal: { kind: 'user', id: 'relay-owner' },
    })

    await expect(
      session.accept('conversation-fixture', 'Final microphone text', {
        bindingId: 'binding-fixture',
        providerId: 'fixture-provider',
        workspaceBindingId: 'workspace-fixture',
        generation: 1,
      })
    ).resolves.toBe('dispatched')
    await vi.waitFor(() => expect(routing.inspect('conversation-fixture').active).toBeNull())

    expect(invoke.mock.calls.map(([envelope]) => envelope.operation)).toEqual([
      'thread.ensure',
      'turn.start',
    ])
    expect(speech).toEqual(['Fixture answer.'])
    expect(clientEvents).toContainEqual({
      type: 'harness.semantic-output',
      classification: 'public-screen',
      text: 'Fixture details',
    })
    expect(clientEvents).toContainEqual({
      type: 'harness.terminal',
      classification: 'terminal',
      outcome: { outcome: 'completed' },
    })
  })

  it('isolates optional feature failure', async () => {
    const archiveStatus: unknown[] = []
    const archive = new OptionalArchiveConsumer({
      workspaceBindingId: 'workspace-fixture',
      resolveProvider: () => ({
        contract: { id: 'archive.append', version: '1.0.0' },
        invoke: async () => {
          throw new Error('archive rejected')
        },
      }),
      authorize: () => true,
      projectStatus: (status) => archiveStatus.push(status),
    })
    const memoryStatus: unknown[] = []
    const memory = new OptionalMemoryConsumer({
      workspaceBindingId: 'workspace-fixture',
      resolveProvider: (contractId) => ({
        contract: { id: contractId, version: '1.0.0' },
        invoke: async () => {
          throw new Error('memory timeout')
        },
      }),
      authorize: () => true,
      timeoutMs: 5,
      projectStatus: (status) => memoryStatus.push(status),
    })
    const dispatch = vi.fn().mockResolvedValue({ outcome: 'completed' })

    const input = { text: 'Optional features may fail' }
    const memoryResult = await memory.run(input, dispatch)
    await archive.accept({
      invocationId: 'invocation-1',
      bindingId: 'binding-fixture',
      threadId: 'thread-fixture',
      turnId: 'turn-fixture',
      attemptId: 'attempt-fixture',
      generation: 1,
      sequence: 1,
      kind: 'semantic-output',
      payload: { audience: 'public', channel: 'screen', text: 'Public result' },
    })

    expect(memoryResult.outcome).toEqual({ outcome: 'completed' })
    expect(dispatch).toHaveBeenCalledWith(input)
    expect(memoryResult.memory.availability).toBe('degraded')
    expect(memoryStatus).toEqual([memoryResult.memory])
    expect(archiveStatus).toEqual([
      { availability: 'degraded', persistence: 'session-only', reason: 'rejected' },
    ])
  })
})

function sequence(prefix: string): () => string {
  let value = 0
  return () => `${prefix}-${++value}`
}

function event(
  invocationId: string,
  identity: { turnId: string; attemptId: string },
  sequence: number,
  kind: 'semantic-output' | 'terminal',
  payload: Record<string, unknown>
) {
  return {
    invocationId,
    bindingId: 'binding-fixture',
    threadId: 'thread-fixture',
    turnId: identity.turnId,
    attemptId: identity.attemptId,
    generation: 1,
    sequence,
    kind,
    payload,
  } as const
}

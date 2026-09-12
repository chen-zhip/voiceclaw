import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ConversationRouting } from '../../src/harness-execution/conversation-routing.js'
import { ConversationThreadMappings } from '../../src/harness-execution/thread-mapping.js'
import { ControlStateStore } from '../../src/plugin-kernel/control-state-store.js'

describe('Harness execution dispatch', () => {
  it('dispatches only finalized text', async () => {
    const dispatchModule = await import('../../src/harness-execution/dispatch.js').catch(() => ({}))
    const HarnessExecutionDispatcher = Reflect.get(dispatchModule, 'HarnessExecutionDispatcher')

    expect(HarnessExecutionDispatcher).toBeTypeOf('function')

    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-harness-dispatch-'))
    const store = await ControlStateStore.open(join(directory, 'control-state.json'), {
      requester: { kind: 'relay-authority', id: 'harness-routing' },
    })
    const invoke = vi.fn(async (envelope: { operation: string }) =>
      envelope.operation === 'thread.ensure' ? { result: { threadId: 'thread-1' } } : { events: [] }
    )
    const dispatcher = new HarnessExecutionDispatcher({
      kernel: { invoke },
      routing: new ConversationRouting({
        createTurnId: () => 'turn-1',
        createAttemptId: () => 'attempt-1',
      }),
      mappings: new ConversationThreadMappings(store),
      selectedContribution: {
        packageId: 'voiceclaw-provider-fixture',
        contributionId: 'fixture-host',
      },
      createInvocationId: sequence('invocation'),
      createTraceId: sequence('trace'),
    })
    const binding = {
      bindingId: 'binding-1',
      providerId: 'provider-1',
      workspaceBindingId: 'workspace-1',
      generation: 3,
    }

    await dispatcher.acceptTranscript({
      conversationId: 'conversation-1',
      text: 'Partial request',
      final: false,
      binding,
    })
    expect(invoke).not.toHaveBeenCalled()

    await dispatcher.acceptTranscript({
      conversationId: 'conversation-1',
      text: 'Final request',
      final: true,
      binding,
    })

    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[0]).toEqual([
      expect.objectContaining({
        contract: { id: 'harness.execution', version: '1.0.0' },
        operation: 'thread.ensure',
        invocationId: 'invocation-1',
        principal: { kind: 'contribution', id: 'routing' },
        scope: { kind: 'workspace', id: 'workspace-1' },
        selectedContribution: {
          packageId: 'voiceclaw-provider-fixture',
          contributionId: 'fixture-host',
        },
        generation: 3,
        cancellation: { supported: false },
      }),
      {
        bindingId: 'binding-1',
        workspaceBindingId: 'workspace-1',
        conversationId: 'conversation-1',
      },
      { authenticatedPrincipal: { kind: 'contribution', id: 'routing' } },
    ])
    expect(invoke.mock.calls[1]).toEqual([
      expect.objectContaining({
        contract: { id: 'harness.execution', version: '1.0.0' },
        operation: 'turn.start',
        invocationId: 'invocation-2',
        generation: 3,
      }),
      {
        bindingId: 'binding-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        attemptId: 'attempt-1',
        generation: 3,
        input: { text: 'Final request' },
      },
      { authenticatedPrincipal: { kind: 'contribution', id: 'routing' } },
    ])
  })
})

function sequence(prefix: string): () => string {
  let value = 0
  return () => `${prefix}-${++value}`
}

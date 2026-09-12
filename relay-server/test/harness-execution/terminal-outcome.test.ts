import { describe, expect, it, vi } from 'vitest'
import { HarnessStreamRouter } from '../../src/harness-execution/stream-routing.js'
import { ConversationRouting } from '../../src/harness-execution/conversation-routing.js'

const attempt = {
  invocationId: 'turn-start-invocation',
  bindingId: 'binding-1',
  threadId: 'thread-1',
  turnId: 'turn-1',
  attemptId: 'attempt-1',
  generation: 4,
  workspaceBindingId: 'workspace-1',
  selectedContribution: {
    packageId: 'voiceclaw-provider-fixture',
    contributionId: 'fixture-host',
  },
}

describe('Harness terminal outcomes', () => {
  it('cancels only the active Attempt', async () => {
    const outcomeModule = await import('../../src/harness-execution/terminal-outcome.js').catch(
      () => ({})
    )
    const HarnessAttemptController = Reflect.get(outcomeModule, 'HarnessAttemptController')

    expect(HarnessAttemptController).toBeTypeOf('function')

    const invoke = vi.fn().mockResolvedValue({ result: { accepted: true } })
    const clientEvents: unknown[] = []
    const speak = vi.fn().mockResolvedValue(undefined)
    const router = new HarnessStreamRouter({
      activeAttempt: attempt,
      speech: { write: speak },
      sendToClient: (event) => clientEvents.push(event),
    })
    const controller = new HarnessAttemptController({
      activeAttempt: attempt,
      kernel: { invoke },
      router,
      authorizeCancel: (principal: { kind: string; id: string }) =>
        principal.kind === 'client' && principal.id === 'desktop-1',
      createInvocationId: () => 'cancel-invocation',
      createTraceId: () => 'cancel-trace',
    })
    const request = {
      principal: { kind: 'client', id: 'desktop-1' },
      bindingId: 'binding-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      attemptId: 'attempt-1',
      generation: 4,
      reason: 'user_request',
    }

    await expect(controller.cancel({ ...request, attemptId: 'attempt-old' })).resolves.toEqual({
      accepted: false,
      code: 'attempt_identity_mismatch',
    })
    expect(invoke).not.toHaveBeenCalled()

    await expect(controller.cancel(request)).resolves.toEqual({
      accepted: true,
      outcome: 'cancelled',
    })
    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        contract: { id: 'harness.execution', version: '1.0.0' },
        operation: 'turn.cancel',
        invocationId: 'cancel-invocation',
        generation: 4,
      }),
      {
        bindingId: 'binding-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        attemptId: 'attempt-1',
        generation: 4,
        reason: 'user_request',
      },
      { authenticatedPrincipal: { kind: 'contribution', id: 'routing' } }
    )
    expect(clientEvents).toEqual([
      {
        type: 'harness.terminal',
        classification: 'terminal',
        outcome: { outcome: 'cancelled' },
      },
    ])

    await expect(
      router.route({
        ...attempt,
        sequence: 2,
        kind: 'semantic-output',
        payload: { audience: 'public', channel: 'speech', text: 'Too late' },
      })
    ).resolves.toMatchObject({ accepted: false })
    await expect(controller.cancel(request)).resolves.toMatchObject({ accepted: false })
    expect(speak).not.toHaveBeenCalled()
    expect(clientEvents).toHaveLength(1)
  })

  it('requires explicit recovery from uncertain execution', () => {
    const routing = new ConversationRouting({
      createTurnId: () => 'turn-stable',
      createAttemptId: sequence('attempt'),
    })
    const turn = routing.accept('conversation-1', { text: 'Preserved request' })
    const failedAttempt = routing.dispatch('conversation-1')

    routing.endAttempt('conversation-1', failedAttempt.id, 'failed')
    expect(routing.inspect('conversation-1').active).toBeNull()
    expect(routing.inspectAttempt('conversation-1', failedAttempt.id)).toEqual({
      ...failedAttempt,
      outcome: 'failed',
    })

    const retryAfterFailure = routing.recover('conversation-1', turn.id)
    expect(retryAfterFailure).toEqual({
      accepted: true,
      attempt: { id: 'attempt-2', turnId: 'turn-stable' },
    })
    routing.endAttempt('conversation-1', retryAfterFailure.attempt.id, 'unknown')
    expect(routing.inspect('conversation-1').active).toBeNull()

    expect(routing.recover('conversation-1', turn.id)).toEqual({
      accepted: false,
      code: 'risk_acknowledgment_required',
      risk: 'Provider side effects may already have occurred',
    })
    expect(routing.inspect('conversation-1').active).toBeNull()

    const retryAfterAcknowledgment = routing.recover('conversation-1', turn.id, {
      acknowledgeOutcomeUnknownRisk: true,
    })
    expect(retryAfterAcknowledgment).toEqual({
      accepted: true,
      attempt: { id: 'attempt-3', turnId: 'turn-stable' },
    })
    expect(routing.inspectAttempt('conversation-1', retryAfterFailure.attempt.id)).toEqual({
      ...retryAfterFailure.attempt,
      outcome: 'unknown',
    })
    expect(retryAfterAcknowledgment.attempt.turnId).toBe(failedAttempt.turnId)
  })
})

function sequence(prefix: string): () => string {
  let value = 0
  return () => `${prefix}-${++value}`
}

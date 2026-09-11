import { describe, expect, it } from 'vitest'
import * as contracts from './index.js'

describe('harness.execution@1', () => {
  it('defines provider-neutral operations and one ordered terminal stream', () => {
    const descriptor = (contracts as Record<string, unknown>).HARNESS_EXECUTION_CONTRACT
    const parseHarnessExecutionRequest = (contracts as Record<string, unknown>)
      .parseHarnessExecutionRequest as ((input: unknown) => { success: boolean }) | undefined
    const parseHarnessExecutionStream = (contracts as Record<string, unknown>)
      .parseHarnessExecutionStream as
      | ((input: unknown) => { success: boolean; data?: unknown })
      | undefined
    const parseHarnessExecutionResult = (contracts as Record<string, unknown>)
      .parseHarnessExecutionResult as
      | ((operation: string, input: unknown) => { success: boolean; data?: unknown })
      | undefined

    expect(descriptor).toEqual({
      id: 'harness.execution',
      version: '1.0.0',
      operations: ['provider.describe', 'thread.ensure', 'turn.start', 'turn.cancel'],
    })
    expect(typeof parseHarnessExecutionRequest).toBe('function')
    expect(typeof parseHarnessExecutionStream).toBe('function')
    expect(typeof parseHarnessExecutionResult).toBe('function')
    if (
      !parseHarnessExecutionRequest ||
      !parseHarnessExecutionStream ||
      !parseHarnessExecutionResult
    )
      return

    expect(
      parseHarnessExecutionRequest({ operation: 'provider.describe', payload: {} }).success
    ).toBe(true)
    expect(
      parseHarnessExecutionRequest({
        operation: 'thread.ensure',
        payload: {
          bindingId: 'binding-1',
          workspaceBindingId: 'workspace-1',
          conversationId: 'conversation-1',
        },
      }).success
    ).toBe(true)
    expect(
      parseHarnessExecutionRequest({
        operation: 'turn.start',
        payload: {
          bindingId: 'binding-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          attemptId: 'attempt-1',
          generation: 2,
          input: { text: 'hello' },
        },
      }).success
    ).toBe(true)
    expect(
      parseHarnessExecutionRequest({
        operation: 'turn.cancel',
        payload: {
          bindingId: 'binding-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          attemptId: 'attempt-1',
          generation: 2,
          reason: 'user_request',
        },
      }).success
    ).toBe(true)

    const event = (sequence: number, kind: string, payload: unknown) => ({
      invocationId: 'invocation-1',
      bindingId: 'binding-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      attemptId: 'attempt-1',
      generation: 2,
      sequence,
      kind,
      payload,
    })
    const stream = [
      event(1, 'semantic-output', { text: 'hello' }),
      event(2, 'terminal', { outcome: 'completed' }),
    ]
    expect(parseHarnessExecutionStream(stream)).toEqual({ success: true, data: stream })
    expect(
      parseHarnessExecutionResult('provider.describe', {
        providerId: 'fixture',
        displayName: 'Fixture provider',
      })
    ).toEqual({
      success: true,
      data: { providerId: 'fixture', displayName: 'Fixture provider' },
    })
    expect(parseHarnessExecutionResult('turn.start', { value: 'not-a-stream' }).success).toBe(false)
    expect(
      parseHarnessExecutionResult('thread.ensure', {
        providerResponse: { secret: 'native' },
      }).success
    ).toBe(false)
    expect(parseHarnessExecutionStream([stream[0]]).success).toBe(false)
    expect(
      parseHarnessExecutionStream([stream[0], event(1, 'terminal', { outcome: 'completed' })])
        .success
    ).toBe(false)
    expect(
      parseHarnessExecutionStream([...stream, event(3, 'terminal', { outcome: 'failed' })]).success
    ).toBe(false)
    expect(
      parseHarnessExecutionRequest({
        operation: 'turn.start',
        payload: {
          bindingId: 'binding-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          attemptId: 'attempt-1',
          generation: 2,
          input: { text: 'hello' },
          providerMethod: 'codex/turn/start',
        },
      }).success
    ).toBe(false)
  })
})

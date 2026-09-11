import { describe, expect, it, vi } from 'vitest'
import * as hostRpc from '../../src/plugin-kernel/host-rpc.js'

const envelope = {
  contract: { id: 'harness.execution', version: '1.0.0' },
  operation: 'turn.start',
  invocationId: 'invocation-1',
  principal: { kind: 'contribution', id: 'routing' },
  scope: { kind: 'workspace', id: 'workspace-1' },
  selectedContribution: {
    packageId: 'voiceclaw-provider-fixture',
    contributionId: 'host',
  },
  generation: 4,
  trace: { traceId: 'trace-1' },
  cancellation: { supported: true, token: 'cancel-1' },
}

describe('Kernel Host RPC', () => {
  it('authorizes and correlates a streaming invocation', async () => {
    const startHostRpcInvocation = (hostRpc as Record<string, unknown>).startHostRpcInvocation as
      | ((options: {
          envelope: unknown
          payload: unknown
          authorize(envelope: unknown): boolean
          dispatch(message: unknown): Promise<void>
        }) => Promise<{
          stream(sequence: number, event: unknown): unknown
          cancel(reason: string): unknown
          terminal(outcome: unknown): unknown
        }>)
      | undefined

    expect(typeof startHostRpcInvocation).toBe('function')
    if (!startHostRpcInvocation) return

    const dispatch = vi.fn().mockResolvedValue(undefined)
    const invocation = await startHostRpcInvocation({
      envelope,
      payload: { bindingId: 'binding-1', turnId: 'turn-1' },
      authorize: () => true,
      dispatch,
    })
    expect(dispatch).toHaveBeenCalledWith({
      kind: 'request',
      invocationId: 'invocation-1',
      generation: 4,
      envelope,
      payload: { bindingId: 'binding-1', turnId: 'turn-1' },
    })
    expect(invocation.stream(1, { kind: 'speech', text: 'hello' })).toEqual({
      kind: 'stream',
      invocationId: 'invocation-1',
      generation: 4,
      sequence: 1,
      event: { kind: 'speech', text: 'hello' },
    })
    expect(invocation.cancel('user_request')).toEqual({
      kind: 'cancel',
      invocationId: 'invocation-1',
      generation: 4,
      reason: 'user_request',
    })
    expect(invocation.terminal({ outcome: 'completed' })).toEqual({
      kind: 'terminal',
      invocationId: 'invocation-1',
      generation: 4,
      outcome: { outcome: 'completed' },
    })

    await expect(
      startHostRpcInvocation({
        envelope,
        payload: {},
        authorize: () => false,
        dispatch,
      })
    ).rejects.toMatchObject({ code: 'authorization_denied' })
    expect(dispatch).toHaveBeenCalledOnce()
    await expect(
      startHostRpcInvocation({
        envelope: { ...envelope, providerMethod: 'codex/turn' },
        payload: {},
        authorize: () => true,
        dispatch,
      })
    ).rejects.toMatchObject({ code: 'invalid_request' })
  })
})

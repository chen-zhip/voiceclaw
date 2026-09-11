import { describe, expect, it } from 'vitest'
import * as contracts from './index.js'

describe('Kernel Invocation Envelope', () => {
  it('validates provider-neutral invocation and failure shapes', () => {
    const parseKernelInvocationEnvelope = (contracts as Record<string, unknown>)
      .parseKernelInvocationEnvelope as
      | ((input: unknown) => { success: boolean; data?: unknown })
      | undefined
    const parseKernelFailure = (contracts as Record<string, unknown>).parseKernelFailure as
      | ((input: unknown) => { success: boolean; data?: unknown })
      | undefined

    expect(typeof parseKernelInvocationEnvelope).toBe('function')
    expect(typeof parseKernelFailure).toBe('function')
    if (!parseKernelInvocationEnvelope || !parseKernelFailure) return

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
      generation: 7,
      trace: { traceId: 'trace-1', parentSpanId: 'span-1' },
      cancellation: { supported: true, token: 'cancel-1' },
    }
    expect(parseKernelInvocationEnvelope(envelope)).toEqual({
      success: true,
      data: envelope,
    })
    for (const invalid of [
      { ...envelope, contract: { id: 'harness.execution', version: 'latest' } },
      { ...envelope, invocationId: '' },
      { ...envelope, generation: -1 },
      { ...envelope, providerMethod: 'codex/turn' },
    ]) {
      expect(parseKernelInvocationEnvelope(invalid).success).toBe(false)
    }

    const failure = {
      code: 'authorization_denied',
      message: 'Capability Grant denied',
      retryable: false,
      details: { reason: 'scope_mismatch' },
    }
    expect(parseKernelFailure(failure)).toEqual({ success: true, data: failure })
    expect(parseKernelFailure({ ...failure, code: 'provider-native-error', raw: {} }).success).toBe(
      false
    )
  })
})

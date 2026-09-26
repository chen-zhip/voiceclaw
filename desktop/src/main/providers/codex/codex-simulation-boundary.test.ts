import { describe, expect, it } from 'vitest'
import type { KernelInvocationEnvelope } from '@voiceclaw/contracts'
import { createCodexContribution } from './codex-provider.js'
import { createSimulatedCodexBoundary } from './codex-simulation-boundary.js'

describe('simulated Codex boundary', () => {
  it('translates typed input into public Codex output without starting an agent', async () => {
    const contribution = createCodexContribution({
      activeHostId: 'local-host',
      configuration: {
        bindingId: 'binding-1',
        workspaceBindingId: 'workspace-1',
        workspacePath: 'C:\\workspace',
        executablePath: 'codex-simulated',
        preferences: {},
        secretRefs: {},
      },
      boundary: createSimulatedCodexBoundary(),
    })

    const thread = (await contribution.invoke({
      envelope: envelope('thread.ensure', 'ensure-1'),
      payload: {
        conversationId: 'conversation-1',
        workspaceBindingId: 'workspace-1',
      },
    })) as { threadId: string }

    const events = (await contribution.invoke({
      envelope: envelope('turn.start', 'turn-1'),
      payload: {
        bindingId: 'binding-1',
        threadId: thread.threadId,
        turnId: 'turn-1',
        attemptId: 'attempt-1',
        generation: 1,
        input: { text: 'typed request' },
      },
    })) as Array<{ kind: string; payload: Record<string, unknown> }>

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'semantic-output',
          payload: expect.objectContaining({
            audience: 'public',
            channel: 'speech',
            text: 'Simulated Codex response to: typed request',
          }),
        }),
        expect.objectContaining({
          kind: 'semantic-output',
          payload: expect.objectContaining({
            audience: 'public',
            channel: 'screen',
            text: 'Simulated Codex response to: typed request',
          }),
        }),
        expect.objectContaining({
          kind: 'terminal',
          payload: { outcome: 'completed' },
        }),
      ])
    )
  })
})

function envelope(operation: string, invocationId: string): KernelInvocationEnvelope {
  return {
    contract: { id: 'harness.execution', version: '1.0.0' },
    operation,
    invocationId,
    principal: { kind: 'contribution', id: 'routing' },
    scope: { kind: 'workspace', id: 'workspace-1' },
    selectedContribution: {
      packageId: 'voiceclaw-provider-codex',
      contributionId: 'codex-provider',
    },
    generation: 1,
    trace: { traceId: `trace-${invocationId}` },
    cancellation: { supported: operation === 'turn.start', token: `cancel-${invocationId}` },
  }
}

import { describe, expect, it, vi } from 'vitest'
import * as boundary from '../../src/plugin-kernel/private-reasoning-boundary.js'

describe('Host RPC output-class boundary', () => {
  it('rejects private reasoning and separates model-inference grants', () => {
    const validateHostRpcOutput = (boundary as Record<string, unknown>).validateHostRpcOutput as
      | ((input: unknown) => { accepted: boolean; code?: string })
      | undefined
    const acceptModelInferenceOutput = (boundary as Record<string, unknown>)
      .acceptModelInferenceOutput as
      | ((
          input: { principalId: string; scope: unknown; output: unknown },
          authorize: (request: Record<string, unknown>) => { authorized: boolean }
        ) => { accepted: boolean; output?: unknown; code?: string })
      | undefined

    expect(typeof validateHostRpcOutput).toBe('function')
    expect(typeof acceptModelInferenceOutput).toBe('function')
    if (!validateHostRpcOutput || !acceptModelInferenceOutput) return

    expect(
      validateHostRpcOutput({
        class: 'private-reasoning',
        provider: 'fixture',
        content: 'hidden chain of thought',
      })
    ).toEqual({ accepted: false, code: 'private_reasoning_forbidden' })
    expect(
      validateHostRpcOutput({
        class: 'semantic-output',
        content: { text: 'public answer' },
      })
    ).toEqual({ accepted: true })

    const authorize = vi.fn(() => ({ authorized: true }))
    expect(
      acceptModelInferenceOutput(
        {
          principalId: 'feature-summary',
          scope: { kind: 'workspace', id: 'workspace-1' },
          output: { class: 'semantic-output', content: { conclusion: 'new public result' } },
        },
        authorize
      )
    ).toEqual({
      accepted: true,
      output: { class: 'semantic-output', content: { conclusion: 'new public result' } },
    })
    expect(authorize).toHaveBeenCalledWith({
      principalId: 'feature-summary',
      contractId: 'model.inference',
      operation: 'infer',
      scope: { kind: 'workspace', id: 'workspace-1' },
    })
    expect(
      acceptModelInferenceOutput(
        {
          principalId: 'feature-summary',
          scope: { kind: 'workspace', id: 'workspace-1' },
          output: { class: 'semantic-output', content: { conclusion: 'denied' } },
        },
        () => ({ authorized: false })
      )
    ).toEqual({ accepted: false, code: 'model_inference_not_granted' })
  })
})

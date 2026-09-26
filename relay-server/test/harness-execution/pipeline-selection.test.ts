import { describe, expect, it, vi } from 'vitest'

describe('Conversation Pipeline selection', () => {
  it('requires an explicit ready Harness binding and preserves rejected input', async () => {
    const selectionModule = await import('../../src/harness-execution/pipeline-selection.js').catch(
      () => ({})
    )
    const selectConversationPipeline = Reflect.get(selectionModule, 'selectConversationPipeline')

    expect(selectConversationPipeline).toBeTypeOf('function')

    const input = { text: 'Keep this request' }
    const assignments = {
      inspect: vi.fn(() => ({
        bindingId: 'binding-1',
        hostId: 'host-1',
        providerId: 'provider-1',
        workspaceBindingId: 'workspace-1',
        generation: 7,
        status: 'ready',
      })),
    }
    const config = {
      mode: 'stt-tts',
      harnessBinding: {
        bindingId: 'binding-1',
        providerId: 'provider-1',
        workspaceBindingId: 'workspace-1',
      },
    }

    expect(selectConversationPipeline(config, input, assignments)).toEqual({
      accepted: true,
      pipeline: 'stt-tts-harness',
      binding: {
        bindingId: 'binding-1',
        hostId: 'host-1',
        providerId: 'provider-1',
        workspaceBindingId: 'workspace-1',
        generation: 7,
      },
      input,
    })

    assignments.inspect.mockReturnValueOnce({
      bindingId: 'binding-1',
      hostId: 'host-1',
      providerId: 'other-provider',
      workspaceBindingId: 'workspace-1',
      generation: 7,
      status: 'ready',
    })
    expect(selectConversationPipeline(config, input, assignments)).toEqual({
      accepted: false,
      pipeline: 'stt-tts-harness',
      reason: 'binding-unavailable',
      input,
      recovery: ['retry', 'reselect-provider', 'return-to-s2s'],
    })
    expect(
      selectConversationPipeline(
        { mode: 'stt-tts', harnessBinding: { ...config.harnessBinding, workspaceBindingId: '' } },
        input,
        assignments
      )
    ).toMatchObject({ accepted: false, reason: 'selection-required', input })
  })

  it.each([
    [{}, 's2s-direct'],
    [{ mode: 'unknown' }, 's2s-direct'],
    [{ mode: 's2s', voiceMode: 'operator' }, 's2s-operator'],
    [{ mode: 's2s', voiceMode: 'supervisor' }, 's2s-direct'],
  ])('retains legacy S2S wire behavior for %o', async (config, expected) => {
    const selectionModule = await import('../../src/harness-execution/pipeline-selection.js').catch(
      () => ({})
    )
    const selectConversationPipeline = Reflect.get(selectionModule, 'selectConversationPipeline')

    expect(selectConversationPipeline(config, { text: 'legacy' }, { inspect() {} })).toMatchObject({
      accepted: true,
      pipeline: expected,
    })
  })
})

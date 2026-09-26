import { describe, expect, it } from 'vitest'

describe('STT/TTS Harness selection model', () => {
  it('models provider-neutral selection, readiness, optional features, and recovery', async () => {
    const selectionModule = await import('./stt-tts-harness-selection.js').catch(() => ({}))
    const STTTTSHarnessSelection = Reflect.get(selectionModule, 'STTTTSHarnessSelection')

    expect(STTTTSHarnessSelection).toBeTypeOf('function')

    const selection = new STTTTSHarnessSelection()
    selection.selectPipeline('stt-tts-harness')
    expect(selection.snapshot()).toMatchObject({
      pipeline: 'stt-tts-harness',
      readiness: 'selection-required',
      providerId: null,
      workspaceBindingId: null,
    })

    selection.selectProvider('provider-fixture-a')
    selection.selectWorkspace('workspace-fixture-a')
    selection.projectReadiness({
      bindingId: 'binding-a',
      providerId: 'provider-fixture-a',
      workspaceBindingId: 'workspace-fixture-a',
      generation: 2,
      status: 'ready',
    })
    selection.projectOptionalFeature('archive', {
      availability: 'absent',
      persistence: 'session-only',
    })
    selection.projectOptionalFeature('memory', {
      availability: 'degraded',
      reason: 'timeout',
    })

    expect(selection.snapshot()).toEqual({
      pipeline: 'stt-tts-harness',
      providerId: 'provider-fixture-a',
      workspaceBindingId: 'workspace-fixture-a',
      readiness: 'ready',
      binding: {
        bindingId: 'binding-a',
        providerId: 'provider-fixture-a',
        workspaceBindingId: 'workspace-fixture-a',
        generation: 2,
      },
      optionalFeatures: {
        archive: { availability: 'absent', persistence: 'session-only' },
        memory: { availability: 'degraded', reason: 'timeout' },
      },
      recovery: [],
    })

    selection.projectReadiness({
      bindingId: 'binding-b',
      providerId: 'provider-fixture-b',
      workspaceBindingId: 'workspace-fixture-b',
      generation: 1,
      status: 'offline',
    })
    expect(selection.snapshot()).toMatchObject({
      readiness: 'unavailable',
      recovery: ['retry', 'reselect-provider', 'return-to-s2s'],
    })

    selection.selectProvider('provider-fixture-b')
    selection.selectWorkspace('workspace-fixture-b')
    selection.projectReadiness({
      bindingId: 'binding-b',
      providerId: 'provider-fixture-b',
      workspaceBindingId: 'workspace-fixture-b',
      generation: 1,
      status: 'ready',
    })
    expect(selection.snapshot()).toMatchObject({
      providerId: 'provider-fixture-b',
      workspaceBindingId: 'workspace-fixture-b',
      readiness: 'ready',
      recovery: [],
    })
  })
})

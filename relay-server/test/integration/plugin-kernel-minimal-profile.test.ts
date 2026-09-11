import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ControlStateStore } from '../../src/plugin-kernel/control-state-store.js'
import * as profileModule from '../../src/plugin-kernel/phase-zero-profile.js'

describe('Phase 0 Profile bootstrap', () => {
  it('activates the minimal Profile without Archive or Memory', async () => {
    const bootstrapPhaseZeroProfile = (profileModule as Record<string, unknown>)
      .bootstrapPhaseZeroProfile as
      | ((input: Record<string, unknown>) => Promise<{
          activationOrder: string[]
          contributions: Array<{ id: string; state: string }>
          effectiveGraph: {
            phase: number
            optionalCapabilities: Array<{ id: string; status: string }>
          }
          loadedModuleIds: string[]
          controlStateStore: ControlStateStore
        }>)
      | undefined

    expect(typeof bootstrapPhaseZeroProfile).toBe('function')
    if (!bootstrapPhaseZeroProfile) return

    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-profile-'))
    const controlStatePath = join(directory, 'control-state.json')
    const contributions = [
      {
        id: 'kernel',
        packageId: 'voiceclaw-kernel',
        feature: { id: 'kernel', displayName: 'Kernel' },
        version: '1.0.0',
        type: 'desktop-service',
        runtime: 'relay',
        provides: [],
        requires: [],
      },
      {
        id: 'desktop-host',
        packageId: 'voiceclaw-desktop-host',
        feature: { id: 'desktop-host', displayName: 'Desktop Host' },
        version: '1.0.0',
        type: 'desktop-service',
        runtime: 'desktop',
        provides: [{ id: 'harness.execution', version: '1.0.0' }],
        requires: [],
      },
      {
        id: 'stt',
        packageId: 'voiceclaw-stt',
        feature: { id: 'stt', displayName: 'STT' },
        version: '1.0.0',
        type: 'desktop-service',
        runtime: 'relay',
        provides: [{ id: 'speech.stt', version: '1.0.0' }],
        requires: [],
      },
      {
        id: 'tts',
        packageId: 'voiceclaw-tts',
        feature: { id: 'tts', displayName: 'TTS' },
        version: '1.0.0',
        type: 'desktop-service',
        runtime: 'relay',
        provides: [{ id: 'speech.tts', version: '1.0.0' }],
        requires: [],
      },
      {
        id: 'routing',
        packageId: 'voiceclaw-routing',
        feature: { id: 'routing', displayName: 'Routing' },
        version: '1.0.0',
        type: 'desktop-service',
        runtime: 'relay',
        provides: [],
        requires: [
          { id: 'harness.execution', range: '^1.0.0' },
          { id: 'speech.stt', range: '^1.0.0' },
          { id: 'speech.tts', range: '^1.0.0' },
        ],
      },
    ]
    const result = await bootstrapPhaseZeroProfile({
      controlStatePath,
      contributions,
      optionalCapabilities: [
        { id: 'archive.read', range: '^1.0.0' },
        { id: 'memory.read', range: '^1.0.0' },
      ],
    })

    expect(result.activationOrder).toEqual([
      'voiceclaw-kernel:kernel',
      'voiceclaw-desktop-host:desktop-host',
      'voiceclaw-stt:stt',
      'voiceclaw-tts:tts',
      'voiceclaw-routing:routing',
    ])
    expect(result.contributions.every((item) => item.state === 'ACTIVE')).toBe(true)
    expect(result.effectiveGraph.optionalCapabilities).toEqual([
      { id: 'archive.read', range: '^1.0.0', status: 'absent' },
      { id: 'memory.read', range: '^1.0.0', status: 'absent' },
    ])
    expect(result.loadedModuleIds).toEqual([
      'voiceclaw-kernel:kernel',
      'voiceclaw-desktop-host:desktop-host',
      'voiceclaw-stt:stt',
      'voiceclaw-tts:tts',
      'voiceclaw-routing:routing',
    ])
    expect(JSON.stringify(result)).not.toMatch(/archive-implementation|memory-implementation/i)

    await expect(
      result.controlStateStore.commit((state) => ({
        ...state,
        messages: [{ text: 'must not persist' }],
      }))
    ).rejects.toMatchObject({ code: 'invalid_control_state' })
    const reopened = await ControlStateStore.open(controlStatePath, {
      requester: { kind: 'relay-authority', id: 'kernel' },
    })
    expect(reopened.read()).toEqual({
      revision: 0,
      grants: [],
      hosts: [],
      assignments: [],
      threadMappings: [],
    })
  })
})

import { describe, expect, it, vi } from 'vitest'
import * as registryModule from '../../src/plugin-kernel/capability-registry.js'

describe('Capability registry', () => {
  it('keeps optional capabilities out of activation edges', async () => {
    const CapabilityRegistry = (registryModule as Record<string, unknown>).CapabilityRegistry as
      | (new (profile: {
          selectedProviders: Record<string, { packageId: string; contributionId: string }>
        }) => {
          register(provider: {
            packageId: string
            contributionId: string
            contract: { id: string; version: string }
            invoke(operation: string, payload: unknown): Promise<unknown>
          }): void
          resolveRequired(requirement: { id: string; range: string }): unknown
          lookupOptional(requirement: { id: string; range: string }):
            | { available: false; reason: string }
            | {
                available: true
                packageId: string
                contributionId: string
                version: string
                invoke(operation: string, payload: unknown): Promise<unknown>
              }
        })
      | undefined

    expect(typeof CapabilityRegistry).toBe('function')
    if (!CapabilityRegistry) return

    const selectedFailure = vi.fn().mockRejectedValue(new Error('selected unavailable'))
    const fallback = vi.fn().mockResolvedValue({ success: true })
    const registry = new CapabilityRegistry({
      selectedProviders: {
        'model.inference': {
          packageId: 'voiceclaw-selected',
          contributionId: 'provider-selected',
        },
      },
    })
    registry.register({
      packageId: 'voiceclaw-selected',
      contributionId: 'provider-selected',
      contract: { id: 'model.inference', version: '1.2.0' },
      invoke: selectedFailure,
    })
    expect(() =>
      registry.register({
        packageId: 'voiceclaw-other',
        contributionId: 'provider-selected',
        contract: { id: 'model.inference', version: '1.2.0' },
        invoke: fallback,
      })
    ).not.toThrow()
    registry.register({
      packageId: 'voiceclaw-fallback',
      contributionId: 'provider-fallback',
      contract: { id: 'model.inference', version: '1.1.0' },
      invoke: fallback,
    })

    expect(registry.resolveRequired({ id: 'model.inference', range: '^1.0.0' })).toMatchObject({
      available: true,
      packageId: 'voiceclaw-selected',
      contributionId: 'provider-selected',
      version: '1.2.0',
    })
    expect(registry.lookupOptional({ id: 'archive.read', range: '^1.0.0' })).toEqual({
      available: false,
      reason: 'No selected compatible provider for archive.read@^1.0.0',
    })

    const optional = registry.lookupOptional({ id: 'model.inference', range: '^1.0.0' })
    expect(optional).toMatchObject({
      available: true,
      packageId: 'voiceclaw-selected',
      contributionId: 'provider-selected',
    })
    if (optional.available) {
      await expect(optional.invoke('infer', {})).resolves.toMatchObject({
        success: false,
        error: { code: 'provider_failure' },
        packageId: 'voiceclaw-selected',
        contributionId: 'provider-selected',
      })
    }
    expect(selectedFailure).toHaveBeenCalledOnce()
    expect(fallback).not.toHaveBeenCalled()
  })
})

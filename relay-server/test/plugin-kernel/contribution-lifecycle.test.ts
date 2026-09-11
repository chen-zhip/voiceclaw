import { describe, expect, it } from 'vitest'
import * as lifecycle from '../../src/plugin-kernel/contribution-lifecycle.js'

describe('Contribution lifecycle', () => {
  it('reports independent Contribution state', () => {
    const reconcileContributionLifecycle = (lifecycle as Record<string, unknown>)
      .reconcileContributionLifecycle as
      | ((inputs: unknown[]) => Array<{
          id: string
          state: string
          reason: string
          callable: boolean
          readiness?: { process: boolean; transport: boolean; session: boolean }
        }>)
      | undefined

    expect(typeof reconcileContributionLifecycle).toBe('function')
    if (!reconcileContributionLifecycle) return

    const states = reconcileContributionLifecycle([
      {
        packageId: 'voiceclaw-states',
        id: 'pending',
        enabled: true,
        requiredDependenciesReady: false,
        loaded: false,
        callable: false,
      },
      {
        packageId: 'voiceclaw-states',
        id: 'loading',
        enabled: true,
        requiredDependenciesReady: true,
        loaded: false,
        callable: false,
      },
      {
        packageId: 'voiceclaw-states',
        id: 'active-ui',
        enabled: true,
        requiredDependenciesReady: true,
        loaded: true,
        callable: true,
      },
      {
        packageId: 'voiceclaw-states',
        id: 'degraded-provider',
        enabled: true,
        requiredDependenciesReady: true,
        loaded: true,
        callable: true,
        readiness: { process: true, transport: true, session: false },
      },
      {
        packageId: 'voiceclaw-states',
        id: 'failed',
        enabled: true,
        requiredDependenciesReady: true,
        loaded: false,
        callable: false,
        failure: 'entry load failed',
      },
      {
        packageId: 'voiceclaw-states',
        id: 'disposed',
        enabled: false,
        requiredDependenciesReady: true,
        loaded: true,
        callable: false,
      },
    ])

    expect(states.map(({ id, state }) => [id, state])).toEqual([
      ['pending', 'PENDING'],
      ['loading', 'LOADING'],
      ['active-ui', 'ACTIVE'],
      ['degraded-provider', 'DEGRADED'],
      ['failed', 'FAILED'],
      ['disposed', 'DISPOSED'],
    ])
    expect(states.every((item) => item.reason.length > 0)).toBe(true)
    expect(states.find((item) => item.id === 'active-ui')).toMatchObject({
      callable: true,
      state: 'ACTIVE',
    })
    expect(states.find((item) => item.id === 'degraded-provider')).toMatchObject({
      callable: true,
      state: 'DEGRADED',
      readiness: { process: true, transport: true, session: false },
    })
  })
})

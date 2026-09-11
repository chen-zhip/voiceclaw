import { describe, expect, it, vi } from 'vitest'
import * as brokerModule from './secret-broker.js'

describe('Desktop Secret broker', () => {
  it('keeps authorized declared secrets inside the local Contribution', async () => {
    const DesktopSecretBroker = (brokerModule as Record<string, unknown>).DesktopSecretBroker as
      | (new (options: {
          resolveSecret(reference: string): Promise<string | undefined>
          audit(event: Record<string, unknown>): void
        }) => {
          invoke(
            request: {
              packageId: string
              contributionId: string
              secretRef: string
              operation: string
              payload: unknown
            },
            context: {
              authenticatedCaller: {
                kind: 'desktop-contribution' | 'relay' | 'client'
                id: string
                packageId?: string
              }
            }
          ): Promise<unknown>
          status(secretRef: string): Promise<{ configured: boolean; reference: string }>
        })
      | undefined

    expect(typeof DesktopSecretBroker).toBe('function')
    if (!DesktopSecretBroker) return

    const logs: Array<Record<string, unknown>> = []
    const resolver = vi.fn(async (reference: string) =>
      reference === 'codex-account' ? 'credential-material' : undefined
    )
    const broker = new DesktopSecretBroker({
      resolveSecret: resolver,
      audit: (event) => logs.push(event),
      contributions: [
        {
          packageId: 'voiceclaw-codex',
          contributionId: 'codex-host',
          declaredSecretRefs: ['codex-account'],
          grantedSecretRefs: ['codex-account'],
          operations: {
            describe: async (secret: string) => ({ used: secret === 'credential-material' }),
            leak: async (secret: string) => ({ relayPayload: secret }),
          },
        },
        {
          packageId: 'voiceclaw-unrelated',
          contributionId: 'codex-host',
          declaredSecretRefs: [],
          grantedSecretRefs: [],
          operations: {},
        },
      ],
    })
    const request = {
      packageId: 'voiceclaw-codex',
      contributionId: 'codex-host',
      secretRef: 'codex-account',
      operation: 'describe',
      payload: {},
    }

    const localContext = {
      authenticatedCaller: {
        kind: 'desktop-contribution' as const,
        packageId: 'voiceclaw-codex',
        id: 'codex-host',
      },
    }
    await expect(broker.invoke(request, localContext)).resolves.toEqual({ used: true })
    await expect(
      broker.invoke({ ...request, operation: 'leak' }, localContext)
    ).rejects.toMatchObject({
      code: 'secret_exfiltration',
    })
    await expect(
      broker.invoke(
        {
          ...request,
          caller: { kind: 'desktop-contribution', id: 'codex-host' },
        } as typeof request,
        { authenticatedCaller: { kind: 'relay', id: 'relay' } }
      )
    ).rejects.toMatchObject({ code: 'secret_access_denied' })
    await expect(
      broker.invoke(request, { authenticatedCaller: { kind: 'client', id: 'client' } })
    ).rejects.toMatchObject({ code: 'secret_access_denied' })
    await expect(
      broker.invoke(request, {
        authenticatedCaller: { kind: 'desktop-contribution', id: 'unrelated' },
      })
    ).rejects.toMatchObject({ code: 'secret_access_denied' })
    await expect(
      broker.invoke(request, {
        authenticatedCaller: {
          kind: 'desktop-contribution',
          packageId: 'voiceclaw-unrelated',
          id: 'codex-host',
        },
      })
    ).rejects.toMatchObject({ code: 'secret_access_denied' })

    expect(await broker.status('codex-account')).toEqual({
      configured: true,
      reference: 'codex-account',
    })
    expect(JSON.stringify({ logs, graph: await broker.status('codex-account') })).not.toContain(
      'credential-material'
    )
    expect(Object.keys(broker)).not.toContain('resolveSecret')
    expect(Object.keys(broker)).not.toContain('contributions')
  })
})

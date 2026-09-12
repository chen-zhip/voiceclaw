import { describe, expect, it, vi } from 'vitest'
import { registerHostManagementIpc } from './host-management-ipc'

describe('Desktop Host management IPC', () => {
  it('manages a Host without credential disclosure', async () => {
    const handlers = new Map<string, (...arguments_: unknown[]) => unknown>()
    const ipc = {
      handle: vi.fn((channel: string, handler: (...arguments_: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
    }
    const management = {
      inspect: vi.fn(async () => [
        { hostId: 'host-1', status: 'online' as const, lastActivityAt: '2026-09-11T00:00:01.000Z' },
      ]),
      enroll: vi.fn(async (_installationId: string) => undefined),
      revoke: vi.fn(async (_hostId: string) => undefined),
      reregister: vi.fn(async (_installationId: string) => undefined),
    }
    registerHostManagementIpc(ipc, management)

    const status = await handlers.get('desktop-host:status')?.({})
    const enrolled = await handlers.get('desktop-host:enroll')?.({}, 'installation-1')
    const revoked = await handlers.get('desktop-host:revoke')?.({}, 'host-1')
    const reregistered = await handlers.get('desktop-host:reregister')?.({}, 'installation-1')

    expect(status).toEqual([
      { hostId: 'host-1', status: 'online', lastActivityAt: '2026-09-11T00:00:01.000Z' },
    ])
    expect(revoked).toEqual({ ok: true })
    expect(enrolled).toEqual({ ok: true })
    expect(reregistered).toEqual({ ok: true })
    expect(management.revoke).toHaveBeenCalledWith('host-1')
    expect(management.enroll).toHaveBeenCalledWith('installation-1')
    expect(management.reregister).toHaveBeenCalledWith('installation-1')
    expect(JSON.stringify({ status, revoked, reregistered })).not.toMatch(
      /credential|secret|token/i
    )
  })
})

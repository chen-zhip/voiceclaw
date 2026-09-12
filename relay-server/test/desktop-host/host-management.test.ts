import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DesktopHostConnectionGateway } from '../../src/desktop-host/host-connection.js'
import { RemoteHostEnrollmentService } from '../../src/desktop-host/host-enrollment.js'
import { ControlStateStore } from '../../src/plugin-kernel/control-state-store.js'

const relayAuthority = { kind: 'relay-authority' as const, id: 'desktop-host-gateway' }

describe('owner Host management', () => {
  it('projects and revokes a registered Host without disclosing credentials', async () => {
    const { HostManagementService } = await import('../../src/desktop-host/host-management.js')
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-host-management-'))
    const path = join(directory, 'control-state.json')
    const store = await ControlStateStore.open(path, { requester: relayAuthority })
    let now = Date.parse('2026-09-11T00:00:00.000Z')
    const secrets = [
      'first-enrollment-token',
      'first-host-credential',
      'second-enrollment-token',
      'second-host-credential',
    ]
    const hostIds = ['host-1', 'host-2']
    const authorizeOwner = (principal: { kind: 'user' | 'client'; id: string }) =>
      principal.kind === 'user' && principal.id === 'owner-1'
    const enrollment = new RemoteHostEnrollmentService(store, {
      now: () => now,
      createSecret: () => secrets.shift() as string,
      createHostId: () => hostIds.shift() as string,
      authorizeOwner,
    })
    const issued = await enrollment.issueToken({
      principal: { kind: 'user', id: 'owner-1' },
      installationId: 'installation-1',
    })
    const registered = await enrollment.exchangeToken({ token: issued.token })
    now += 1_000
    const gateway = new DesktopHostConnectionGateway(store, { now: () => now })
    await gateway.admit({
      mode: 'remote',
      credential: { kind: 'host', value: registered.credential },
    })
    const management = new HostManagementService(store, gateway, enrollment, { authorizeOwner })

    await expect(management.inspect({ kind: 'client', id: 'not-owner' })).rejects.toMatchObject({
      code: 'owner_authorization_required',
    })
    const projection = await management.inspect({ kind: 'user', id: 'owner-1' })
    expect(projection).toEqual([
      {
        hostId: 'host-1',
        status: 'online',
        lastActivityAt: '2026-09-11T00:00:01.000Z',
      },
    ])
    expect(JSON.stringify(projection)).not.toMatch(/credential|verifier|first-host-credential/i)

    await management.revoke({ kind: 'user', id: 'owner-1' }, 'host-1')
    const restartedStore = await ControlStateStore.open(path, { requester: relayAuthority })
    const restartedGateway = new DesktopHostConnectionGateway(restartedStore)
    const restartedManagement = new HostManagementService(
      restartedStore,
      restartedGateway,
      enrollment,
      { authorizeOwner }
    )
    await expect(
      restartedGateway.admit({
        mode: 'remote',
        credential: { kind: 'host', value: registered.credential },
      })
    ).rejects.toMatchObject({ code: 'host_authentication_failed' })
    await expect(restartedManagement.inspect({ kind: 'user', id: 'owner-1' })).resolves.toEqual([
      {
        hostId: 'host-1',
        status: 'revoked',
        lastActivityAt: '2026-09-11T00:00:01.000Z',
      },
    ])

    const replacementToken = await management.requestReregistration(
      { kind: 'user', id: 'owner-1' },
      'installation-1'
    )
    const replacement = await enrollment.exchangeToken({ token: replacementToken.token })
    expect(replacement).toEqual({ hostId: 'host-2', credential: 'second-host-credential' })
    const replacementProjection = await management.inspect({ kind: 'user', id: 'owner-1' })
    expect(replacementProjection).toEqual([
      { hostId: 'host-2', status: 'offline', lastActivityAt: null },
    ])
    expect(JSON.stringify(replacementProjection)).not.toContain(replacement.credential)
  })
})

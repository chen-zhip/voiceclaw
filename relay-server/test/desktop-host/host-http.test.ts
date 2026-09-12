import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { ControlStateStore } from '../../src/plugin-kernel/control-state-store.js'
import { RemoteHostEnrollmentService } from '../../src/desktop-host/host-enrollment.js'
import { createRelayServer } from '../../src/server-factory.js'
import { createRelayHttpApplication } from '../../src/relay-http-app.js'
import { DesktopHostConnectionGateway } from '../../src/desktop-host/host-connection.js'
import { HostManagementService } from '../../src/desktop-host/host-management.js'

const relayAuthority = { kind: 'relay-authority' as const, id: 'desktop-host-gateway' }

describe('Desktop Host HTTP adapter', () => {
  const servers: ReturnType<typeof createRelayServer>['server'][] = []

  afterEach(async () => {
    await Promise.all(
      servers
        .splice(0)
        .map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
    )
  })

  it('manages a Host without credential disclosure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-host-http-management-'))
    const path = join(directory, 'control-state.json')
    const store = await ControlStateStore.open(path, { requester: relayAuthority })
    let now = Date.parse('2026-09-11T00:00:00.000Z')
    const secrets = ['token-1', 'credential-1', 'token-2', 'credential-2']
    const ids = ['host-1', 'host-2']
    const authorizeOwner = (principal: { kind: 'user' | 'client'; id: string }) =>
      principal.kind === 'user' && principal.id === 'owner-1'
    const enrollment = new RemoteHostEnrollmentService(store, {
      now: () => now,
      createSecret: () => secrets.shift() as string,
      createHostId: () => ids.shift() as string,
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
    const app = createRelayHttpApplication({
      enrollment,
      management,
      authenticateOwner: async (credential) =>
        credential === 'owner-key' ? { kind: 'user', id: 'owner-1' } : null,
    })
    const { server } = createRelayServer(app, {})
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    expect((await fetch(`${origin}/host/registrations`)).status).toBe(401)
    const online = await fetch(`${origin}/host/registrations`, {
      headers: { authorization: 'Bearer owner-key' },
    })
    expect(await online.json()).toEqual([
      { hostId: 'host-1', status: 'online', lastActivityAt: '2026-09-11T00:00:01.000Z' },
    ])

    const revoked = await postJson(`${origin}/host/registrations/host-1/revoke`, {}, 'owner-key')
    expect(revoked.status).toBe(204)
    await expect(
      gateway.admit({
        mode: 'remote',
        credential: { kind: 'host', value: registered.credential },
      })
    ).rejects.toMatchObject({ code: 'host_authentication_failed' })
    const restarted = await ControlStateStore.open(path, { requester: relayAuthority })
    expect(restarted.read().hosts[0].revoked).toBe(true)

    const reregistered = await postJson(
      `${origin}/host/reregistration-tokens`,
      { installationId: 'installation-1' },
      'owner-key'
    )
    expect(reregistered.status).toBe(201)
    expect(await reregistered.json()).toEqual({
      token: 'token-2',
      expiresAt: '2026-09-11T00:05:01.000Z',
    })
    const projection = await fetch(`${origin}/host/registrations`, {
      headers: { authorization: 'Bearer owner-key' },
    })
    expect(JSON.stringify(await projection.json())).not.toMatch(/credential|verifier|token-2/i)
  })

  it('enrolls one remote Host through owner HTTP routes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-host-http-'))
    const store = await ControlStateStore.open(join(directory, 'control-state.json'), {
      requester: relayAuthority,
    })
    let now = Date.parse('2026-09-11T00:00:00.000Z')
    const secrets = ['enrollment-token', 'host-credential', 'expired-enrollment-token']
    const enrollment = new RemoteHostEnrollmentService(store, {
      now: () => now,
      createSecret: () => secrets.shift() as string,
      createHostId: (() => {
        const ids = ['host-1', 'host-2']
        return () => ids.shift() as string
      })(),
      authorizeOwner: (principal) => principal.kind === 'user' && principal.id === 'owner-1',
      enrollmentTtlMs: 60_000,
    })
    const app = createRelayHttpApplication({
      enrollment,
      authenticateOwner: async (credential) =>
        credential === 'owner-key' ? { kind: 'user', id: 'owner-1' } : null,
    })
    const { server } = createRelayServer(app, {})
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    const unauthorized = await postJson(`${origin}/host/enrollment-tokens`, {
      installationId: 'desktop-installation-1',
    })
    expect(unauthorized.status).toBe(401)

    const issued = await postJson(
      `${origin}/host/enrollment-tokens`,
      { installationId: 'desktop-installation-1' },
      'owner-key'
    )
    expect(issued.status).toBe(201)
    expect(await issued.json()).toEqual({
      token: 'enrollment-token',
      expiresAt: '2026-09-11T00:01:00.000Z',
    })

    const exchanged = await postJson(`${origin}/host/enrollments`, {
      token: 'enrollment-token',
    })
    expect(exchanged.status).toBe(201)
    expect(await exchanged.json()).toEqual({ hostId: 'host-1', credential: 'host-credential' })
    expect(JSON.stringify(store.read())).not.toContain('host-credential')

    const reused = await postJson(`${origin}/host/enrollments`, { token: 'enrollment-token' })
    expect(reused.status).toBe(401)
    expect(await reused.json()).toEqual({ error: 'invalid_enrollment_token' })

    const expiring = await postJson(
      `${origin}/host/enrollment-tokens`,
      { installationId: 'desktop-installation-2' },
      'owner-key'
    )
    expect(expiring.status).toBe(201)
    now += 60_001
    const expired = await postJson(`${origin}/host/enrollments`, {
      token: 'expired-enrollment-token',
    })
    expect(expired.status).toBe(401)
    expect(await expired.json()).toEqual({ error: 'invalid_enrollment_token' })
  })
})

function postJson(url: string, body: unknown, bearer?: string) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

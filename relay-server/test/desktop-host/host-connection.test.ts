import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { RemoteHostEnrollmentService } from '../../src/desktop-host/host-enrollment.js'
import { ControlStateStore } from '../../src/plugin-kernel/control-state-store.js'
import { createRelayServer } from '../../src/server-factory.js'
import { mountRelayWebSocketGateways } from '../../src/websocket-gateways.js'

const relayAuthority = { kind: 'relay-authority' as const, id: 'desktop-host-gateway' }

describe('Desktop Host connection', () => {
  it('passes one bundled Host bootstrap only through the controlled launch', async () => {
    const { BundledLocalHostBootstrap, DesktopHostConnectionGateway } =
      await import('../../src/desktop-host/host-connection.js')
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-local-host-wss-'))
    const store = await ControlStateStore.open(join(directory, 'control-state.json'), {
      requester: relayAuthority,
    })
    const bootstrap = new BundledLocalHostBootstrap({
      stackId: 'bundled-stack-1',
      hostId: 'local-host-1',
      createSecret: () => 'per-startup-bootstrap-secret',
    })
    const gateway = new DesktopHostConnectionGateway(store, { localBootstrap: bootstrap })
    const { server } = createRelayServer((_request, response) => response.end(), {})
    const sockets = mountRelayWebSocketGateways(server, {
      hostGateway: gateway,
      onClientConnection: (socket) => socket.close(1000),
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/host/ws`

    try {
      await expect(
        connectWithHeaders(url, 'voiceclaw.host.v1', {
          'x-voiceclaw-local-host-bootstrap': bootstrap.credential(),
          'x-voiceclaw-local-host-stack-id': 'another-stack',
        })
      ).rejects.toMatchObject({ statusCode: 401 })
      const socket = await connectWithHeaders(url, 'voiceclaw.host.v1', {
        'x-voiceclaw-local-host-bootstrap': bootstrap.credential(),
        'x-voiceclaw-local-host-stack-id': 'bundled-stack-1',
      })
      expect(socket.protocol).toBe('voiceclaw.host.v1')
      expect(gateway.isConnected('local-host-1')).toBe(true)
      socket.close(1000)
      await onceClosed(socket)

      bootstrap.expire()
      await expect(
        connectWithHeaders(url, 'voiceclaw.host.v1', {
          'x-voiceclaw-local-host-bootstrap': 'per-startup-bootstrap-secret',
          'x-voiceclaw-local-host-stack-id': 'bundled-stack-1',
        })
      ).rejects.toMatchObject({ statusCode: 401 })
      expect(store.read()).toMatchObject({ revision: 0, hosts: [] })
    } finally {
      sockets.clientWebSocketServer.close()
      sockets.hostWebSocketServer.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('admits only a remote Host on the dedicated WSS path', async () => {
    const { DesktopHostConnectionGateway } =
      await import('../../src/desktop-host/host-connection.js')
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-host-wss-'))
    const path = join(directory, 'control-state.json')
    const store = await ControlStateStore.open(path, { requester: relayAuthority })
    let now = Date.parse('2026-09-11T00:00:00.000Z')
    const secrets = ['enrollment-token', 'registered-host-credential']
    const enrollment = new RemoteHostEnrollmentService(store, {
      now: () => now,
      createSecret: () => secrets.shift() as string,
      createHostId: () => 'host-1',
      authorizeOwner: () => true,
      credentialTtlMs: 60_000,
    })
    const token = await enrollment.issueToken({
      principal: { kind: 'user', id: 'owner-1' },
      installationId: 'installation-1',
    })
    const registered = await enrollment.exchangeToken({ token: token.token })

    const restartedStore = await ControlStateStore.open(path, { requester: relayAuthority })
    const gateway = new DesktopHostConnectionGateway(restartedStore, { now: () => now })
    const { server } = createRelayServer((_request, response) => response.end(), {})
    const sockets = mountRelayWebSocketGateways(server, {
      hostGateway: gateway,
      onClientConnection: (socket) => socket.close(1000),
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`

    try {
      await expect(
        connect(`${origin}/host/ws`, 'voiceclaw.host.v1', 'Host invalid-credential')
      ).rejects.toMatchObject({ statusCode: 401 })
      for (const authorization of [
        `Bearer ${registered.credential}`,
        `Provider ${registered.credential}`,
      ]) {
        await expect(
          connect(`${origin}/host/ws`, 'voiceclaw.host.v1', authorization)
        ).rejects.toMatchObject({ statusCode: 401 })
      }
      await expect(
        connect(`${origin}/host/ws`, 'voiceclaw.client.v1', `Host ${registered.credential}`)
      ).rejects.toMatchObject({ statusCode: 400 })

      const hostSocket = await connect(
        `${origin}/host/ws`,
        'voiceclaw.host.v1',
        `Host ${registered.credential}`
      )
      expect(hostSocket.protocol).toBe('voiceclaw.host.v1')
      expect(gateway.isConnected('host-1')).toBe(true)
      hostSocket.close(1000)
      await onceClosed(hostSocket)

      const clientSocket = await connect(
        `${origin}/ws`,
        'voiceclaw.client.v1',
        `Host ${registered.credential}`
      )
      await onceClosed(clientSocket)
      expect(gateway.isConnected('host-1')).toBe(false)

      now += 60_001
      await expect(
        connect(`${origin}/host/ws`, 'voiceclaw.host.v1', `Host ${registered.credential}`)
      ).rejects.toMatchObject({ statusCode: 401 })

      now = Date.parse('2026-09-11T00:00:30.000Z')
      await restartedStore.commit((state) => ({
        ...state,
        hosts: state.hosts.map((host) => ({ ...host, revoked: true })),
      }))
      await expect(
        connect(`${origin}/host/ws`, 'voiceclaw.host.v1', `Host ${registered.credential}`)
      ).rejects.toMatchObject({ statusCode: 401 })
    } finally {
      sockets.clientWebSocketServer.close()
      sockets.hostWebSocketServer.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('authenticates only the registered remote Host', async () => {
    const { DesktopHostConnectionGateway } =
      await import('../../src/desktop-host/host-connection.js')
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-host-connection-'))
    const path = join(directory, 'control-state.json')
    const store = await ControlStateStore.open(path, { requester: relayAuthority })
    let now = Date.parse('2026-09-11T00:00:00.000Z')
    const secrets = ['enrollment-token', 'registered-host-credential']
    const enrollment = new RemoteHostEnrollmentService(store, {
      now: () => now,
      createSecret: () => secrets.shift() as string,
      createHostId: () => 'host-1',
      authorizeOwner: () => true,
      enrollmentTtlMs: 60_000,
      credentialTtlMs: 3_600_000,
    })
    const token = await enrollment.issueToken({
      principal: { kind: 'user', id: 'owner-1' },
      installationId: 'installation-1',
    })
    const registered = await enrollment.exchangeToken({ token: token.token })

    const restartedStore = await ControlStateStore.open(path, { requester: relayAuthority })
    const gateway = new DesktopHostConnectionGateway(restartedStore, { now: () => now })
    await expect(
      gateway.admit({
        mode: 'remote',
        credential: { kind: 'host', value: registered.credential },
      })
    ).resolves.toEqual({ kind: 'desktop-host', id: 'host-1' })
    await expect(
      gateway.admit({
        mode: 'remote',
        credential: { kind: 'host', value: 'invalid-credential' },
      })
    ).rejects.toMatchObject({ code: 'host_authentication_failed' })
    for (const kind of ['client', 'provider'] as const) {
      await expect(
        gateway.admit({
          mode: 'remote',
          credential: { kind, value: registered.credential },
        })
      ).rejects.toMatchObject({ code: 'host_authentication_failed' })
    }

    now += 3_600_001
    await expect(
      gateway.admit({
        mode: 'remote',
        credential: { kind: 'host', value: registered.credential },
      })
    ).rejects.toMatchObject({ code: 'host_authentication_failed' })

    now = Date.parse('2026-09-11T00:30:00.000Z')
    await restartedStore.commit((state) => ({
      ...state,
      hosts: state.hosts.map((host) => ({ ...host, revoked: true })),
    }))
    await expect(
      gateway.admit({
        mode: 'remote',
        credential: { kind: 'host', value: registered.credential },
      })
    ).rejects.toMatchObject({ code: 'host_authentication_failed' })
  })

  it('authenticates the bundled local Host without issuance', async () => {
    const { BundledLocalHostBootstrap, DesktopHostConnectionGateway } =
      await import('../../src/desktop-host/host-connection.js')
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-local-host-'))
    const path = join(directory, 'control-state.json')
    const store = await ControlStateStore.open(path, { requester: relayAuthority })
    const bootstrap = new BundledLocalHostBootstrap({
      stackId: 'bundled-stack-1',
      hostId: 'local-host-1',
      createSecret: () => 'per-startup-bootstrap-secret',
    })
    const gateway = new DesktopHostConnectionGateway(store, { localBootstrap: bootstrap })

    await expect(
      gateway.admit({
        mode: 'local',
        stackId: 'bundled-stack-1',
        credential: { kind: 'local-bootstrap', value: bootstrap.credential() },
      })
    ).resolves.toEqual({ kind: 'desktop-host', id: 'local-host-1' })
    await expect(
      gateway.admit({
        mode: 'local',
        stackId: 'another-stack',
        credential: { kind: 'local-bootstrap', value: bootstrap.credential() },
      })
    ).rejects.toMatchObject({ code: 'host_authentication_failed' })

    bootstrap.expire()
    await expect(
      gateway.admit({
        mode: 'local',
        stackId: 'bundled-stack-1',
        credential: { kind: 'local-bootstrap', value: 'per-startup-bootstrap-secret' },
      })
    ).rejects.toMatchObject({ code: 'host_authentication_failed' })
    expect(store.read().revision).toBe(0)
    expect(store.read().hosts).toEqual([])
  })
})

function connect(url: string, protocol: string, authorization: string): Promise<WebSocket> {
  return connectWithHeaders(url, protocol, { authorization })
}

function connectWithHeaders(
  url: string,
  protocol: string,
  headers: Record<string, string>
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, protocol, { headers })
    socket.once('open', () => resolve(socket))
    socket.once('unexpected-response', (_request, response) => {
      reject(
        Object.assign(new Error(`Upgrade rejected with ${response.statusCode}`), {
          statusCode: response.statusCode,
        })
      )
    })
    socket.once('error', reject)
  })
}

function onceClosed(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve()
  return new Promise((resolve) => socket.once('close', () => resolve()))
}

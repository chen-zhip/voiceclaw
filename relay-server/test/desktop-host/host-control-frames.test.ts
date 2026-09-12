import { mkdtemp } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { describe, expect, it } from 'vitest'
import { ActiveHostAssignmentService } from '../../src/desktop-host/active-assignment.js'
import { DesktopHostConnectionGateway } from '../../src/desktop-host/host-connection.js'
import { RemoteHostEnrollmentService } from '../../src/desktop-host/host-enrollment.js'
import { ControlStateStore } from '../../src/plugin-kernel/control-state-store.js'
import { createRelayServer } from '../../src/server-factory.js'
import { mountRelayWebSocketGateways } from '../../src/websocket-gateways.js'

const relayAuthority = { kind: 'relay-authority' as const, id: 'desktop-host-gateway' }

describe('Desktop Host control frames', () => {
  it('updates assignment state through authenticated Host control frames', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-host-control-'))
    const store = await ControlStateStore.open(join(directory, 'control-state.json'), {
      requester: relayAuthority,
    })
    const secrets = ['enrollment-token', 'host-credential']
    const enrollment = new RemoteHostEnrollmentService(store, {
      createSecret: () => secrets.shift() as string,
      createHostId: () => 'host-1',
      authorizeOwner: () => true,
    })
    const token = await enrollment.issueToken({
      principal: { kind: 'user', id: 'owner-1' },
      installationId: 'installation-1',
    })
    const registered = await enrollment.exchangeToken({ token: token.token })
    const connections = new DesktopHostConnectionGateway(store)
    const assignments = new ActiveHostAssignmentService(store, connections)
    const { server } = createRelayServer((_request, response) => response.end(), {})
    const mounted = mountRelayWebSocketGateways(server, {
      hostGateway: connections,
      assignments,
      onClientConnection: (socket) => socket.close(1000),
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/host/ws`
    const socket = await connect(url, registered.credential)
    const selection = {
      bindingId: 'binding-1',
      hostId: 'host-1',
      providerId: 'codex',
      workspaceBindingId: 'workspace-1',
    }

    try {
      await expect(mounted.hostControl.assign(relayAuthority, selection)).rejects.toMatchObject({
        code: 'host_unavailable',
      })
      socket.send(
        JSON.stringify({
          version: 1,
          type: 'host.readiness.report',
          bindingId: 'binding-1',
          providerId: 'codex',
          workspaceBindingId: 'workspace-1',
          ready: true,
        })
      )
      await expect(nextFrame(socket)).resolves.toEqual({
        version: 1,
        type: 'host.readiness.accepted',
        bindingId: 'binding-1',
        providerId: 'codex',
        workspaceBindingId: 'workspace-1',
      })

      await expect(
        mounted.hostControl.assign({ kind: 'desktop-host', id: 'host-1' }, selection)
      ).rejects.toMatchObject({ code: 'relay_authority_required' })
      const assignmentFrame = nextFrame(socket)
      await expect(mounted.hostControl.assign(relayAuthority, selection)).resolves.toMatchObject({
        generation: 1,
        status: 'ready',
      })
      await expect(assignmentFrame).resolves.toEqual({
        version: 1,
        type: 'host.assignment',
        bindingId: 'binding-1',
        providerId: 'codex',
        workspaceBindingId: 'workspace-1',
        generation: 1,
      })

      socket.send(
        JSON.stringify({
          version: 1,
          type: 'host.assignment',
          bindingId: 'binding-1',
          providerId: 'codex',
          workspaceBindingId: 'workspace-1',
          generation: 99,
        })
      )
      await expect(nextClose(socket)).resolves.toBe(1008)
      expect(store.read().assignments[0].generation).toBe(1)
    } finally {
      socket.close()
      mounted.clientWebSocketServer.close()
      mounted.hostWebSocketServer.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

function connect(url: string, credential: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, 'voiceclaw.host.v1', {
      headers: { authorization: `Host ${credential}` },
    })
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

function nextFrame(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once('message', (data) => resolve(JSON.parse(data.toString())))
  })
}

function nextClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once('close', (code) => resolve(code)))
}

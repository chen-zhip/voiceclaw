import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { describe, expect, it, vi } from 'vitest'
import { ActiveHostAssignmentService } from '../../src/desktop-host/active-assignment.js'
import { DesktopHostConnectionGateway } from '../../src/desktop-host/host-connection.js'
import { ControlStateStore } from '../../src/plugin-kernel/control-state-store.js'
import { createRelayServer } from '../../src/server-factory.js'
import { mountRelayWebSocketGateways } from '../../src/websocket-gateways.js'

const identity = {
  invocationId: 'invocation-1',
  bindingId: 'binding-1',
  threadId: 'thread-1',
  turnId: 'turn-1',
  attemptId: 'attempt-1',
  generation: 4,
}

describe('Host disconnect outcome', () => {
  it('records disconnect outcome from the live transport', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-live-disconnect-'))
    const store = await ControlStateStore.open(join(directory, 'control-state.json'), {
      requester: { kind: 'relay-authority', id: 'desktop-host-gateway' },
    })
    const credential = 'disconnect-host-credential'
    await store.commit((state) => ({
      ...state,
      hosts: [
        {
          id: 'host-1',
          installationId: 'installation-1',
          credentialVerifier: `sha256:${createHash('sha256').update(credential).digest('hex')}`,
          credentialExpiresAt: null,
          enrollmentTokenVerifier: `sha256:${'0'.repeat(64)}`,
          enrolledAt: '2026-09-11T00:00:00.000Z',
          lastActivityAt: null,
          authorityVersion: 1,
          revoked: false,
        },
      ],
    }))
    const connections = new DesktopHostConnectionGateway(store)
    const assignments = new ActiveHostAssignmentService(store, connections)
    const observed: unknown[] = []
    const { server } = createRelayServer((_request, response) => response.end(), {})
    const mounted = mountRelayWebSocketGateways(server, {
      hostGateway: connections,
      assignments,
      authorizeInvocation: () => true,
      observeDisconnect: (outcome) => observed.push(outcome),
      onClientConnection: (socket) => socket.close(1000),
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/host/ws`
    let socket = await connect(url, credential)
    const selection = {
      bindingId: 'binding-1',
      hostId: 'host-1',
      providerId: 'codex',
      workspaceBindingId: 'workspace-1',
    }
    let generation = 1
    const invoke = (invocationId: string, attemptId: string, events: unknown[]) =>
      mounted.hostControl.invoke({
        hostId: 'host-1',
        providerId: 'codex',
        envelope: {
          contract: { id: 'harness.execution', version: '1.0.0' },
          operation: 'turn.start',
          invocationId,
          principal: { kind: 'contribution', id: 'routing' },
          scope: { kind: 'workspace', id: 'workspace-1' },
          selectedContribution: {
            packageId: 'voiceclaw-codex',
            contributionId: 'codex-provider',
          },
          generation,
          trace: { traceId: `trace-${invocationId}` },
          cancellation: { supported: true, token: `cancel-${invocationId}` },
        },
        payload: {
          bindingId: 'binding-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          attemptId,
          generation,
          input: { text: 'Preserve this request' },
        },
        onEvent: (event) => events.push(event),
      })

    try {
      await reportReady(socket)
      const assignmentFrame = nextFrame(socket)
      await mounted.hostControl.assign(
        { kind: 'relay-authority', id: 'desktop-host-gateway' },
        selection
      )
      await assignmentFrame
      socket.close(1000)
      await closed(socket)
      const beforeDispatchEvents: unknown[] = []
      await expect(
        invoke('before-dispatch', 'attempt-before', beforeDispatchEvents)
      ).resolves.toMatchObject({
        input: { text: 'Preserve this request' },
        events: [expect.objectContaining({ kind: 'terminal', payload: { outcome: 'failed' } })],
        recovery: { automaticReplay: false, automaticHostSubstitution: false },
      })

      socket = await connect(url, credential)
      generation = assignments.inspect('binding-1').generation
      expect(generation).toBe(2)
      await reportReady(socket)
      const request = nextFrame(socket)
      const afterDispatchEvents: unknown[] = []
      const completion = invoke('after-dispatch', 'attempt-after', afterDispatchEvents)
      await request
      socket.send(
        JSON.stringify({
          version: 1,
          type: 'host.invocation.event',
          event: {
            ...identity,
            invocationId: 'after-dispatch',
            attemptId: 'attempt-after',
            generation,
            sequence: 1,
            kind: 'semantic-output',
            payload: { text: 'Partial answer' },
          },
        })
      )
      await vi.waitFor(() => expect(afterDispatchEvents).toHaveLength(1))
      socket.close(1000)
      await expect(completion).resolves.toMatchObject({
        input: { text: 'Preserve this request' },
        events: [
          expect.objectContaining({ kind: 'semantic-output' }),
          expect.objectContaining({ kind: 'terminal', payload: { outcome: 'unknown' } }),
        ],
        recovery: { automaticReplay: false, automaticHostSubstitution: false },
      })
      expect(observed).toHaveLength(2)
    } finally {
      socket.close()
      mounted.hostWebSocketServer.clients.forEach((client) => client.terminate())
      mounted.clientWebSocketServer.close()
      mounted.hostWebSocketServer.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('classifies disconnect without replay or failover', async () => {
    const { HostInvocationAttempt } = await import('../../src/desktop-host/disconnect-outcome.js')
    const prepared = new HostInvocationAttempt({
      ...identity,
      input: { text: 'Preserve this request' },
    })
    expect(prepared.disconnect()).toEqual({
      input: { text: 'Preserve this request' },
      events: [
        {
          ...identity,
          sequence: 1,
          kind: 'terminal',
          payload: { outcome: 'failed' },
        },
      ],
      recovery: { automaticReplay: false, automaticHostSubstitution: false },
    })

    const dispatched = new HostInvocationAttempt({
      ...identity,
      attemptId: 'attempt-2',
      input: { text: 'Preserve this request' },
    })
    dispatched.markDispatched()
    dispatched.acceptPublicEvent({
      ...identity,
      attemptId: 'attempt-2',
      sequence: 1,
      kind: 'semantic-output',
      payload: { text: 'Partial answer' },
    })
    expect(dispatched.disconnect()).toEqual({
      input: { text: 'Preserve this request' },
      events: [
        {
          ...identity,
          attemptId: 'attempt-2',
          sequence: 1,
          kind: 'semantic-output',
          payload: { text: 'Partial answer' },
        },
        {
          ...identity,
          attemptId: 'attempt-2',
          sequence: 2,
          kind: 'terminal',
          payload: { outcome: 'unknown' },
        },
      ],
      recovery: { automaticReplay: false, automaticHostSubstitution: false },
    })
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

async function reportReady(socket: WebSocket): Promise<void> {
  const accepted = nextFrame(socket)
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
  await accepted
}

function nextFrame(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) =>
    socket.once('message', (data) => resolve(JSON.parse(data.toString())))
  )
}

function closed(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve()
  return new Promise((resolve) => socket.once('close', () => resolve()))
}

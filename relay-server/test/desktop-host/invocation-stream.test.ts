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

const contributionIdentity = {
  packageId: 'voiceclaw-codex',
  contributionId: 'codex-provider',
}

const assignment = {
  bindingId: 'binding-1',
  hostId: 'host-1',
  providerId: 'codex',
  workspaceBindingId: 'workspace-1',
  generation: 7,
}

function envelope(operation: string, invocationId: string) {
  return {
    contract: { id: 'harness.execution', version: '1.0.0' },
    operation,
    invocationId,
    principal: { kind: 'contribution' as const, id: 'routing' },
    scope: { kind: 'workspace', id: 'workspace-1' },
    selectedContribution: contributionIdentity,
    generation: 7,
    trace: { traceId: `trace-${invocationId}` },
    cancellation: { supported: true, token: `cancel-${invocationId}` },
  }
}

describe('harness.execution Host projection', () => {
  it('fences every frame against Relay Control State', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-authoritative-fence-'))
    const store = await ControlStateStore.open(join(directory, 'control-state.json'), {
      requester: { kind: 'relay-authority', id: 'desktop-host-gateway' },
    })
    const credential = 'fence-host-credential'
    await seedHost(store, credential)
    const connections = new DesktopHostConnectionGateway(store)
    const assignments = new ActiveHostAssignmentService(store, connections)
    const { server } = createRelayServer((_request, response) => response.end(), {})
    const mounted = mountRelayWebSocketGateways(server, {
      hostGateway: connections,
      assignments,
      authorizeInvocation: () => true,
      onClientConnection: (socket) => socket.close(1000),
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const socket = await connectHost(
      `ws://127.0.0.1:${(server.address() as AddressInfo).port}/host/ws`,
      credential
    )
    try {
      await readyAndAssign(socket, mounted, assignment)
      await expect(
        mounted.hostControl.invoke({
          hostId: 'host-1',
          providerId: 'codex',
          envelope: { ...envelope('turn.start', 'already-stale'), generation: 0 },
          payload: {
            bindingId: 'binding-1',
            threadId: 'thread-1',
            turnId: 'turn-1',
            attemptId: 'attempt-stale',
            generation: 0,
            input: { text: 'stale' },
          },
          onEvent: () => undefined,
        })
      ).rejects.toMatchObject({ code: 'stale_generation' })

      const accepted: unknown[] = []
      const request = nextSocketFrame(socket)
      const completion = mounted.hostControl.invoke({
        hostId: 'host-1',
        providerId: 'codex',
        envelope: { ...envelope('turn.start', 'authority-change'), generation: 1 },
        payload: {
          bindingId: 'binding-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          attemptId: 'attempt-1',
          generation: 1,
          input: { text: 'start current' },
        },
        onEvent: (event) => accepted.push(event),
      })
      await request
      socket.send(
        JSON.stringify({
          version: 1,
          type: 'host.invocation.event',
          event: streamEvent(
            1,
            'semantic-output',
            { text: 'accepted prefix' },
            'authority-change',
            1
          ),
        })
      )
      await vi.waitFor(() => expect(accepted).toHaveLength(1))
      await store.commit((state) => ({
        ...state,
        assignments: state.assignments.map((current) => ({
          ...current,
          generation: current.generation + 1,
        })),
      }))
      socket.send(
        JSON.stringify({
          version: 1,
          type: 'host.invocation.event',
          event: streamEvent(2, 'terminal', { outcome: 'completed' }, 'authority-change', 1),
        })
      )
      await expect(completion).rejects.toMatchObject({ code: 'stale_generation' })
      expect(accepted).toHaveLength(1)
    } finally {
      socket.close()
      mounted.clientWebSocketServer.close()
      mounted.hostWebSocketServer.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('routes cancellation only to the live owning Attempt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-cancel-host-'))
    const store = await ControlStateStore.open(join(directory, 'control-state.json'), {
      requester: { kind: 'relay-authority', id: 'desktop-host-gateway' },
    })
    const credential = 'cancel-host-credential'
    await seedHost(store, credential)
    const connections = new DesktopHostConnectionGateway(store)
    const assignments = new ActiveHostAssignmentService(store, connections)
    const { server } = createRelayServer((_request, response) => response.end(), {})
    const mounted = mountRelayWebSocketGateways(server, {
      hostGateway: connections,
      assignments,
      authorizeInvocation: ({ envelope: candidate }) => candidate.principal.id === 'routing',
      onClientConnection: (socket) => socket.close(1000),
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const socket = await connectHost(
      `ws://127.0.0.1:${(server.address() as AddressInfo).port}/host/ws`,
      credential
    )
    try {
      await readyAndAssign(socket, mounted, assignment)
      const requestFrame = nextSocketFrame(socket)
      const turn = mounted.hostControl.invoke({
        hostId: 'host-1',
        providerId: 'codex',
        envelope: { ...envelope('turn.start', 'live-invocation'), generation: 1 },
        payload: {
          bindingId: 'binding-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          attemptId: 'attempt-1',
          generation: 1,
          input: { text: 'work' },
        },
        onEvent: () => undefined,
      })
      await requestFrame
      const cancelPayload = {
        bindingId: 'binding-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        attemptId: 'attempt-1',
        generation: 1,
        reason: 'user_request',
      }
      await expect(
        mounted.hostControl.cancel({
          hostId: 'host-1',
          providerId: 'codex',
          envelope: { ...envelope('turn.cancel', 'bad-attempt'), generation: 1 },
          payload: { ...cancelPayload, attemptId: 'attempt-2' },
        })
      ).rejects.toMatchObject({ code: 'cancellation_mismatch' })
      await expect(
        mounted.hostControl.cancel({
          hostId: 'host-1',
          providerId: 'codex',
          envelope: {
            ...envelope('turn.cancel', 'unauthorized-cancel'),
            generation: 1,
            principal: { kind: 'contribution', id: 'intruder' },
          },
          payload: cancelPayload,
        })
      ).rejects.toMatchObject({ code: 'operation_unauthorized' })

      const cancelFrame = nextSocketFrame(socket)
      await expect(
        mounted.hostControl.cancel({
          hostId: 'host-1',
          providerId: 'codex',
          envelope: { ...envelope('turn.cancel', 'valid-cancel'), generation: 1 },
          payload: cancelPayload,
        })
      ).resolves.toEqual({ accepted: true })
      await expect(cancelFrame).resolves.toMatchObject({
        version: 1,
        type: 'host.invocation.cancel',
        invocationId: 'live-invocation',
        attemptId: 'attempt-1',
        reason: 'user_request',
      })
      socket.send(
        JSON.stringify({
          version: 1,
          type: 'host.invocation.event',
          event: streamEvent(1, 'terminal', { outcome: 'cancelled' }, 'live-invocation', 1),
        })
      )
      await expect(turn).resolves.toMatchObject({
        events: [expect.objectContaining({ kind: 'terminal' })],
      })
      await expect(
        mounted.hostControl.cancel({
          hostId: 'host-1',
          providerId: 'codex',
          envelope: { ...envelope('turn.cancel', 'late-cancel'), generation: 1 },
          payload: cancelPayload,
        })
      ).rejects.toMatchObject({ code: 'cancellation_mismatch' })

      const closed = nextSocketClose(socket)
      socket.send(
        JSON.stringify({
          version: 1,
          type: 'host.invocation.event',
          event: streamEvent(2, 'semantic-output', { text: 'late' }, 'live-invocation', 1),
        })
      )
      await expect(closed).resolves.toBe(1008)
    } finally {
      socket.close()
      mounted.clientWebSocketServer.close()
      mounted.hostWebSocketServer.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('forwards validated public events incrementally', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-incremental-host-'))
    const store = await ControlStateStore.open(join(directory, 'control-state.json'), {
      requester: { kind: 'relay-authority', id: 'desktop-host-gateway' },
    })
    const credential = 'host-credential'
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
    const { server } = createRelayServer((_request, response) => response.end(), {})
    const mounted = mountRelayWebSocketGateways(server, {
      hostGateway: connections,
      assignments,
      authorizeInvocation: () => true,
      onClientConnection: (socket) => socket.close(1000),
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const socket = await connectHost(
      `ws://127.0.0.1:${(server.address() as AddressInfo).port}/host/ws`,
      credential
    )
    const selection = { ...assignment }

    try {
      socket.send(
        JSON.stringify({
          version: 1,
          type: 'host.readiness.report',
          bindingId: selection.bindingId,
          providerId: selection.providerId,
          workspaceBindingId: selection.workspaceBindingId,
          ready: true,
        })
      )
      await nextSocketFrame(socket)
      const assignedFrame = nextSocketFrame(socket)
      await mounted.hostControl.assign(
        { kind: 'relay-authority', id: 'desktop-host-gateway' },
        selection
      )
      await assignedFrame

      const received: unknown[] = []
      const requestFrame = nextSocketFrame(socket)
      const completion = mounted.hostControl.invoke({
        hostId: 'host-1',
        providerId: 'codex',
        envelope: { ...envelope('turn.start', 'incremental-invocation'), generation: 1 },
        payload: {
          bindingId: 'binding-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          attemptId: 'attempt-1',
          generation: 1,
          input: { text: 'stream this' },
        },
        onEvent: (event) => received.push(event),
      })
      await expect(requestFrame).resolves.toMatchObject({
        version: 1,
        type: 'host.invocation.request',
        envelope: { invocationId: 'incremental-invocation' },
      })
      socket.send(
        JSON.stringify({
          version: 1,
          type: 'host.invocation.event',
          event: streamEvent(
            1,
            'semantic-output',
            { text: 'visible now' },
            'incremental-invocation',
            1
          ),
        })
      )
      await vi.waitFor(() => expect(received).toHaveLength(1))
      expect(received[0]).toMatchObject({
        kind: 'semantic-output',
        payload: { text: 'visible now' },
      })

      socket.send(
        JSON.stringify({
          version: 1,
          type: 'host.invocation.event',
          event: streamEvent(2, 'terminal', { outcome: 'completed' }, 'incremental-invocation', 1),
        })
      )
      await expect(completion).resolves.toEqual({ events: received })
      expect(
        received.filter((event) => (event as { kind: string }).kind === 'terminal')
      ).toHaveLength(1)
      expect(JSON.stringify(received)).not.toMatch(
        /providerMethod|providerEvent|providerPayload|privateReasoning/i
      )
    } finally {
      socket.close()
      mounted.clientWebSocketServer.close()
      mounted.hostWebSocketServer.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('authorizes every Host operation before writing a frame', async () => {
    const { HarnessExecutionHostConnection } =
      await import('../../src/desktop-host/invocation-stream.js')
    const invokeContribution = vi.fn(async () => ({ providerId: 'codex' }))
    let hostAuthorized = true
    let grantAuthorized = false
    let generation = 7
    const connection = new HarnessExecutionHostConnection({
      authenticatedHost: { kind: 'desktop-host', id: 'host-1' },
      contribution: contributionIdentity,
      providerId: 'codex',
      isHostAuthorized: () => hostAuthorized,
      readCurrentAssignment: () => ({
        bindingId: 'binding-1',
        hostId: 'host-1',
        providerId: 'codex',
        workspaceBindingId: 'workspace-1',
        generation,
      }),
      authorize: () => grantAuthorized,
      invokeContribution,
    })
    const requests = [
      ['provider.describe', {}],
      [
        'thread.ensure',
        {
          bindingId: 'binding-1',
          workspaceBindingId: 'workspace-1',
          conversationId: 'conversation-1',
        },
      ],
      [
        'turn.start',
        {
          bindingId: 'binding-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          attemptId: 'attempt-1',
          generation: 7,
          input: { text: 'hello' },
        },
      ],
      [
        'turn.cancel',
        {
          bindingId: 'binding-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          attemptId: 'attempt-1',
          generation: 7,
          reason: 'user_request',
        },
      ],
    ] as const

    for (const [operation, payload] of requests) {
      await expect(
        connection.invoke(envelope(operation, `denied-${operation}`), payload)
      ).rejects.toMatchObject({ code: 'operation_unauthorized' })
    }
    expect(invokeContribution).not.toHaveBeenCalled()

    grantAuthorized = true
    hostAuthorized = false
    await expect(
      connection.invoke(envelope('provider.describe', 'revoked-host'), {})
    ).rejects.toMatchObject({ code: 'host_authentication_required' })
    hostAuthorized = true
    generation = 8
    await expect(
      connection.invoke(envelope('provider.describe', 'stale-assignment'), {})
    ).rejects.toMatchObject({ code: 'stale_generation' })
    expect(invokeContribution).not.toHaveBeenCalled()
  })

  it('streams one request to one terminal outcome', async () => {
    const { HarnessExecutionHostConnection } =
      await import('../../src/desktop-host/invocation-stream.js')
    let returnProviderNativeField = false
    const invokeContribution = vi.fn(
      async (request: { operation: string; payload: Record<string, unknown> }) => {
        if (returnProviderNativeField) return { providerResponse: { method: 'native' } }
        if (request.operation === 'provider.describe') {
          return { providerId: 'codex', capabilityProfileVersion: '1.0.0' }
        }
        if (request.operation === 'thread.ensure') return { threadId: 'thread-1' }
        if (request.operation === 'turn.cancel') return { accepted: true }
        return [
          {
            invocationId: 'invocation-turn',
            bindingId: 'binding-1',
            threadId: 'thread-1',
            turnId: 'turn-1',
            attemptId: 'attempt-1',
            generation: 7,
            sequence: 1,
            kind: 'semantic-output',
            payload: { text: 'Hello' },
          },
          {
            invocationId: 'invocation-turn',
            bindingId: 'binding-1',
            threadId: 'thread-1',
            turnId: 'turn-1',
            attemptId: 'attempt-1',
            generation: 7,
            sequence: 2,
            kind: 'terminal',
            payload: { outcome: 'completed' },
          },
        ]
      }
    )
    const connection = new HarnessExecutionHostConnection({
      authenticatedHost: { kind: 'desktop-host', id: 'host-1' },
      contribution: contributionIdentity,
      providerId: 'codex',
      isHostAuthorized: () => true,
      readCurrentAssignment: () => assignment,
      authorize: () => true,
      invokeContribution,
    })
    expect(connection.operations).toEqual([
      'provider.describe',
      'thread.ensure',
      'turn.start',
      'turn.cancel',
    ])

    await expect(
      connection.invoke(envelope('provider.describe', 'invocation-describe'), {})
    ).resolves.toEqual({ result: { providerId: 'codex', capabilityProfileVersion: '1.0.0' } })
    await expect(
      connection.invoke(envelope('thread.ensure', 'invocation-thread'), {
        bindingId: 'binding-1',
        workspaceBindingId: 'workspace-1',
        conversationId: 'conversation-1',
      })
    ).resolves.toEqual({ result: { threadId: 'thread-1' } })
    const turn = await connection.invoke(envelope('turn.start', 'invocation-turn'), {
      bindingId: 'binding-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      attemptId: 'attempt-1',
      generation: 7,
      input: { text: 'Say hello' },
    })
    expect(turn).toEqual({
      events: [
        expect.objectContaining({ sequence: 1, kind: 'semantic-output' }),
        expect.objectContaining({ sequence: 2, kind: 'terminal' }),
      ],
    })
    expect(JSON.stringify(turn)).not.toMatch(/providerMethod|providerEvent|providerPayload/i)
    await expect(
      connection.invoke(envelope('turn.cancel', 'invocation-cancel'), {
        bindingId: 'binding-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        attemptId: 'attempt-1',
        generation: 7,
        reason: 'user_request',
      })
    ).rejects.toMatchObject({ code: 'cancellation_mismatch' })
    expect(invokeContribution).toHaveBeenCalledTimes(3)

    returnProviderNativeField = true
    await expect(
      connection.invoke(envelope('provider.describe', 'invocation-native'), {})
    ).rejects.toMatchObject({ code: 'invalid_host_output' })
  })

  it('forwards only an authorized cancellation', async () => {
    const { HarnessExecutionHostConnection } =
      await import('../../src/desktop-host/invocation-stream.js')
    let finishTurn: (() => void) | undefined
    const invokeContribution = vi.fn(
      async (request: { operation: string; payload: Record<string, unknown> }) => {
        if (request.operation === 'turn.cancel') return { accepted: true }
        return new Promise((resolve) => {
          finishTurn = () =>
            resolve([
              {
                invocationId: 'active-invocation',
                bindingId: 'binding-1',
                threadId: 'thread-1',
                turnId: 'turn-1',
                attemptId: 'attempt-1',
                generation: 7,
                sequence: 1,
                kind: 'semantic-output',
                payload: { text: 'partial' },
              },
              {
                invocationId: 'active-invocation',
                bindingId: 'binding-1',
                threadId: 'thread-1',
                turnId: 'turn-1',
                attemptId: 'attempt-1',
                generation: 7,
                sequence: 2,
                kind: 'terminal',
                payload: { outcome: 'cancelled' },
              },
              {
                invocationId: 'active-invocation',
                bindingId: 'binding-1',
                threadId: 'thread-1',
                turnId: 'turn-1',
                attemptId: 'attempt-1',
                generation: 7,
                sequence: 3,
                kind: 'semantic-output',
                payload: { text: 'must not be forwarded' },
              },
            ])
        })
      }
    )
    const connection = new HarnessExecutionHostConnection({
      authenticatedHost: { kind: 'desktop-host', id: 'host-1' },
      contribution: contributionIdentity,
      providerId: 'codex',
      isHostAuthorized: () => true,
      readCurrentAssignment: () => assignment,
      authorize: (candidate: { principal: { id: string } }) => candidate.principal.id === 'routing',
      invokeContribution,
    })
    const turnPayload = {
      bindingId: 'binding-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      attemptId: 'attempt-1',
      generation: 7,
      input: { text: 'Keep working' },
    }
    const activeTurn = connection.invoke(envelope('turn.start', 'active-invocation'), turnPayload)
    await vi.waitFor(() => expect(invokeContribution).toHaveBeenCalledTimes(1))

    await expect(
      connection.invoke(
        {
          ...envelope('turn.cancel', 'unauthorized-cancel'),
          principal: { kind: 'contribution', id: 'intruder' },
        },
        {
          bindingId: 'binding-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          attemptId: 'attempt-1',
          generation: 7,
          reason: 'user_request',
        }
      )
    ).rejects.toMatchObject({ code: 'operation_unauthorized' })
    await expect(
      connection.invoke(envelope('turn.cancel', 'mismatched-cancel'), {
        bindingId: 'binding-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        attemptId: 'another-attempt',
        generation: 7,
        reason: 'user_request',
      })
    ).rejects.toMatchObject({ code: 'cancellation_mismatch' })
    expect(invokeContribution).toHaveBeenCalledTimes(1)

    await expect(
      connection.invoke(envelope('turn.cancel', 'authorized-cancel'), {
        bindingId: 'binding-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        attemptId: 'attempt-1',
        generation: 7,
        reason: 'user_request',
      })
    ).resolves.toEqual({ result: { accepted: true } })
    expect(invokeContribution).toHaveBeenLastCalledWith(
      expect.objectContaining({ operation: 'turn.cancel' })
    )
    finishTurn?.()
    await expect(activeTurn).rejects.toMatchObject({ code: 'event_after_terminal' })
  })

  it('rejects stale or invalid stream events', async () => {
    const { HarnessExecutionHostConnection } =
      await import('../../src/desktop-host/invocation-stream.js')
    let events: unknown[] = []
    const connection = new HarnessExecutionHostConnection({
      authenticatedHost: { kind: 'desktop-host', id: 'host-1' },
      contribution: contributionIdentity,
      providerId: 'codex',
      isHostAuthorized: () => true,
      readCurrentAssignment: () => assignment,
      authorize: () => true,
      invokeContribution: async () => events,
    })
    const event = (
      sequence: number,
      kind: 'semantic-output' | 'terminal',
      overrides: Record<string, unknown> = {}
    ) => ({
      invocationId: 'fenced-invocation',
      bindingId: 'binding-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      attemptId: 'attempt-1',
      generation: 7,
      sequence,
      kind,
      payload: kind === 'terminal' ? { outcome: 'completed' } : { text: 'public' },
      ...overrides,
    })
    const invoke = () =>
      connection.invoke(envelope('turn.start', 'fenced-invocation'), {
        bindingId: 'binding-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        attemptId: 'attempt-1',
        generation: 7,
        input: { text: 'Fence this' },
      })

    events = [
      event(1, 'semantic-output', { generation: 6 }),
      event(2, 'terminal', { generation: 6 }),
    ]
    await expect(invoke()).rejects.toMatchObject({ code: 'stale_generation' })
    events = [event(1, 'semantic-output'), event(1, 'terminal')]
    await expect(invoke()).rejects.toMatchObject({ code: 'out_of_order_sequence' })
    events = [
      event(1, 'semantic-output', { invocationId: 'another-invocation' }),
      event(2, 'terminal', { invocationId: 'another-invocation' }),
    ]
    await expect(invoke()).rejects.toMatchObject({ code: 'invalid_host_output' })
    events = [
      event(1, 'semantic-output', { attemptId: 'another-attempt' }),
      event(2, 'terminal', { attemptId: 'another-attempt' }),
    ]
    await expect(invoke()).rejects.toMatchObject({ code: 'invalid_host_output' })
    events = [event(1, 'terminal'), event(2, 'semantic-output')]
    await expect(invoke()).rejects.toMatchObject({ code: 'event_after_terminal' })
    events = [event(1, 'terminal'), event(2, 'terminal')]
    await expect(invoke()).rejects.toMatchObject({ code: 'second_terminal' })
  })
})

function connectHost(url: string, credential: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, 'voiceclaw.host.v1', {
      headers: { authorization: `Host ${credential}` },
    })
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

async function seedHost(store: ControlStateStore, credential: string): Promise<void> {
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
}

async function readyAndAssign(
  socket: WebSocket,
  mounted: ReturnType<typeof mountRelayWebSocketGateways>,
  selection: typeof assignment
): Promise<void> {
  const readinessAccepted = nextSocketFrame(socket)
  socket.send(
    JSON.stringify({
      version: 1,
      type: 'host.readiness.report',
      bindingId: selection.bindingId,
      providerId: selection.providerId,
      workspaceBindingId: selection.workspaceBindingId,
      ready: true,
    })
  )
  await readinessAccepted
  const assignmentFrame = nextSocketFrame(socket)
  await mounted.hostControl.assign(
    { kind: 'relay-authority', id: 'desktop-host-gateway' },
    selection
  )
  await assignmentFrame
}

function nextSocketFrame(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once('message', (data) => resolve(JSON.parse(data.toString())))
  })
}

function nextSocketClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once('close', (code) => resolve(code)))
}

function streamEvent(
  sequence: number,
  kind: 'semantic-output' | 'terminal',
  payload: Record<string, unknown>,
  invocationId: string,
  generation: number
) {
  return {
    invocationId,
    bindingId: 'binding-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    attemptId: 'attempt-1',
    generation,
    sequence,
    kind,
    payload,
  }
}

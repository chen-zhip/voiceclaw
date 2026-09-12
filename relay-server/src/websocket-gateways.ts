import type { IncomingMessage, Server as HttpServer } from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
import type { DesktopHostConnectionGateway } from './desktop-host/host-connection.js'
import type { ActiveHostAssignmentService } from './desktop-host/active-assignment.js'
import {
  parseHarnessExecutionRequest,
  parseHarnessExecutionResult,
  parseKernelInvocationEnvelope,
  type HarnessExecutionEvent,
  type KernelInvocationEnvelope,
} from '@voiceclaw/contracts'
import { GenerationStreamFence } from './plugin-kernel/generation-fence.js'
import { validateHostRpcOutput } from './plugin-kernel/private-reasoning-boundary.js'
import { HarnessExecutionConnectionError } from './desktop-host/invocation-stream.js'
import { HostInvocationAttempt } from './desktop-host/disconnect-outcome.js'
import {
  HostContributionRegistry,
  type KernelGraph,
  type ProviderReadiness,
} from './desktop-host/provider-registration.js'
import {
  admitHostUpgrade,
  isContributionRegistrationFrame,
  isInvocationEventFrame,
  isInvocationResultFrame,
  isReadinessFrame,
  rejectHostUpgrade,
} from './desktop-host/host-wire-protocol.js'

const HOST_SUBPROTOCOL = 'voiceclaw.host.v1'

type LiveAttempt = {
  hostId: string
  providerId: string
  envelope: KernelInvocationEnvelope
  payload: Record<string, unknown>
  fence: GenerationStreamFence
  events: HarnessExecutionEvent[]
  onEvent(event: HarnessExecutionEvent): void
  resolve(value: { events: HarnessExecutionEvent[] }): void
  reject(error: Error): void
  disconnect: HostInvocationAttempt
}

type DisconnectOutcome = ReturnType<HostInvocationAttempt['disconnect']>

type LiveResultAttempt = {
  bindingId: string
  hostId: string
  providerId: string
  envelope: KernelInvocationEnvelope
  reject(error: Error): void
  resolve(value: { result: Record<string, unknown> }): void
}

export interface RelayWebSocketGatewayOptions {
  hostGateway: DesktopHostConnectionGateway
  assignments?: ActiveHostAssignmentService
  contributions?: HostContributionRegistry
  kernel?: { effectiveGraph(): KernelGraph }
  authorizeInvocation?(input: {
    hostId: string
    envelope: KernelInvocationEnvelope
    payload: Record<string, unknown>
  }): boolean
  observeDisconnect?(outcome: DisconnectOutcome): void
  onClientConnection(socket: WebSocket, request: IncomingMessage): void
  onHostConnection?(
    socket: WebSocket,
    principal: { kind: 'desktop-host'; id: string },
    request: IncomingMessage
  ): void
}

export function mountRelayWebSocketGateways(
  server: HttpServer,
  options: RelayWebSocketGatewayOptions
) {
  const clientWebSocketServer = new WebSocketServer({ noServer: true, maxPayload: 4 * 1_048_576 })
  const hostWebSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: 1_048_576,
    handleProtocols: (protocols) => (protocols.has(HOST_SUBPROTOCOL) ? HOST_SUBPROTOCOL : false),
  })
  const hostSockets = new Map<string, WebSocket>()
  const attempts = new Map<string, LiveAttempt>()
  const resultAttempts = new Map<string, LiveResultAttempt>()

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://relay.invalid').pathname
    if (pathname === '/ws') {
      clientWebSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        clientWebSocketServer.emit('connection', webSocket, request)
        options.onClientConnection(webSocket, request)
      })
      return
    }
    if (pathname !== '/host/ws') {
      rejectHostUpgrade(socket, 404, 'Not Found')
      return
    }

    void admitHostUpgrade(request, options.hostGateway).then(
      async (principal) => {
        if (options.assignments) {
          try {
            await options.assignments.authoritativeReconnect(
              { kind: 'relay-authority', id: 'desktop-host-gateway' },
              principal
            )
          } catch (error) {
            if ((error as { code?: string }).code !== 'assignment_not_found') throw error
          }
        }
        hostWebSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
          hostWebSocketServer.emit('connection', webSocket, request)
          hostSockets.get(principal.id)?.close(1000, 'replaced')
          hostSockets.set(principal.id, webSocket)
          webSocket.on('message', (data) => {
            void handleHostFrame(
              webSocket,
              principal,
              data.toString(),
              options.assignments,
              attempts,
              resultAttempts,
              options.contributions,
              options.kernel
            )
          })
          webSocket.once('close', () => {
            if (hostSockets.get(principal.id) !== webSocket) return
            hostSockets.delete(principal.id)
            for (const [invocationId, attempt] of attempts) {
              if (attempt.hostId !== principal.id) continue
              const outcome = attempt.disconnect.disconnect()
              attempts.delete(invocationId)
              const terminal = outcome.events.at(-1) as HarnessExecutionEvent
              attempt.onEvent(terminal)
              options.observeDisconnect?.(outcome)
              attempt.resolve(outcome)
            }
            for (const [invocationId, attempt] of resultAttempts) {
              if (attempt.hostId !== principal.id) continue
              resultAttempts.delete(invocationId)
              attempt.reject(gatewayInvocationError('host_authentication_required'))
            }
            if (options.assignments) options.assignments.hostDisconnected(principal)
            else options.hostGateway.disconnect(principal.id)
          })
          options.onHostConnection?.(webSocket, principal, request)
        })
      },
      (statusCode: number) => rejectHostUpgrade(socket, statusCode, 'Unauthorized')
    )
  })

  const hostControl = {
    async assign(
      principal: { kind: 'relay-authority' | 'desktop-host'; id: string },
      input: {
        bindingId: string
        hostId: string
        providerId: string
        workspaceBindingId: string
      }
    ) {
      if (!options.assignments) throw new Error('host_assignment_service_unavailable')
      const assignment = await options.assignments.select(principal, input)
      const target = hostSockets.get(input.hostId)
      if (!target || target.readyState !== WebSocket.OPEN) {
        throw new Error('host_socket_unavailable')
      }
      target.send(
        JSON.stringify({
          version: 1,
          type: 'host.assignment',
          bindingId: input.bindingId,
          providerId: input.providerId,
          workspaceBindingId: input.workspaceBindingId,
          generation: assignment.generation,
        })
      )
      return assignment
    },
    async invoke(input: {
      hostId: string
      providerId: string
      envelope: unknown
      payload: unknown
      onEvent(event: HarnessExecutionEvent): void
    }): Promise<
      { events: HarnessExecutionEvent[] } | { result: Record<string, unknown> } | DisconnectOutcome
    > {
      const parsedEnvelope = parseKernelInvocationEnvelope(input.envelope)
      if (!parsedEnvelope.success) throw gatewayInvocationError('invalid_host_request')
      const envelope = parsedEnvelope.data
      const parsedRequest = parseHarnessExecutionRequest({
        operation: envelope.operation,
        payload: input.payload,
      })
      if (!parsedRequest.success || envelope.operation === 'turn.cancel') {
        throw gatewayInvocationError('invalid_host_request')
      }
      const payload = parsedRequest.data.payload
      const assignment =
        typeof payload.bindingId === 'string'
          ? options.assignments?.inspect(payload.bindingId)
          : options.assignments?.find({
              hostId: input.hostId,
              providerId: input.providerId,
              workspaceBindingId: envelope.scope.id as string,
            })
      if (
        !assignment ||
        assignment.status === 'unready' ||
        !matchesAssignment(assignment, {
          hostId: input.hostId,
          providerId: input.providerId,
          workspaceBindingId: envelope.scope.id,
          generation: envelope.generation,
          payloadGeneration: payload.generation,
        })
      ) {
        throw gatewayInvocationError('stale_generation')
      }
      if (!options.authorizeInvocation?.({ hostId: input.hostId, envelope, payload })) {
        throw gatewayInvocationError('operation_unauthorized')
      }
      if (
        options.contributions &&
        !options.contributions.isCallable({
          hostId: input.hostId,
          packageId: envelope.selectedContribution.packageId,
          contributionId: envelope.selectedContribution.contributionId,
          providerId: input.providerId,
        })
      ) {
        throw gatewayInvocationError('host_contribution_mismatch')
      }
      if (attempts.has(envelope.invocationId)) throw gatewayInvocationError('invalid_host_request')
      if (resultAttempts.has(envelope.invocationId))
        throw gatewayInvocationError('invalid_host_request')
      const activeForBinding =
        [...attempts.values()].filter(
          (attempt) => attempt.payload.bindingId === assignment.bindingId
        ).length +
        [...resultAttempts.values()].filter((attempt) => attempt.bindingId === assignment.bindingId)
          .length
      if (activeForBinding >= 1) {
        throw gatewayInvocationError('invalid_host_request')
      }
      const target = hostSockets.get(input.hostId)
      if (envelope.operation !== 'turn.start') {
        if (!target || target.readyState !== WebSocket.OPEN || assignment.status === 'offline') {
          throw gatewayInvocationError('host_authentication_required')
        }
        const completion = new Promise<{ result: Record<string, unknown> }>((resolve, reject) => {
          resultAttempts.set(envelope.invocationId, {
            bindingId: assignment.bindingId,
            hostId: input.hostId,
            providerId: input.providerId,
            envelope,
            resolve,
            reject,
          })
        })
        try {
          target.send(
            JSON.stringify({
              version: 1,
              type: 'host.invocation.request',
              envelope,
              payload,
            })
          )
        } catch {
          resultAttempts.delete(envelope.invocationId)
          throw gatewayInvocationError('host_authentication_required')
        }
        return completion
      }
      const disconnect = new HostInvocationAttempt({
        invocationId: envelope.invocationId,
        bindingId: payload.bindingId as string,
        threadId: payload.threadId as string,
        turnId: payload.turnId as string,
        attemptId: payload.attemptId as string,
        generation: envelope.generation,
        input: payload.input as Record<string, unknown>,
      })
      if (!target || target.readyState !== WebSocket.OPEN || assignment.status === 'offline') {
        const outcome = disconnect.disconnect()
        input.onEvent(outcome.events.at(-1) as HarnessExecutionEvent)
        options.observeDisconnect?.(outcome)
        return outcome
      }
      const completion = new Promise<{ events: HarnessExecutionEvent[] } | DisconnectOutcome>(
        (resolve, reject) => {
          attempts.set(envelope.invocationId, {
            hostId: input.hostId,
            providerId: input.providerId,
            envelope,
            payload,
            fence: new GenerationStreamFence(envelope.generation),
            events: [],
            onEvent: input.onEvent,
            resolve,
            reject,
            disconnect,
          })
        }
      )
      try {
        target.send(
          JSON.stringify({
            version: 1,
            type: 'host.invocation.request',
            envelope,
            payload,
          })
        )
        disconnect.markDispatched()
      } catch {
        attempts.delete(envelope.invocationId)
        const outcome = disconnect.disconnect()
        input.onEvent(outcome.events.at(-1) as HarnessExecutionEvent)
        options.observeDisconnect?.(outcome)
        return outcome
      }
      return completion
    },
    async cancel(input: {
      hostId: string
      providerId: string
      envelope: unknown
      payload: unknown
    }): Promise<{ accepted: true }> {
      const parsedEnvelope = parseKernelInvocationEnvelope(input.envelope)
      if (!parsedEnvelope.success) throw gatewayInvocationError('invalid_host_request')
      const envelope = parsedEnvelope.data
      const parsedRequest = parseHarnessExecutionRequest({
        operation: envelope.operation,
        payload: input.payload,
      })
      if (!parsedRequest.success || envelope.operation !== 'turn.cancel') {
        throw gatewayInvocationError('invalid_host_request')
      }
      const payload = parsedRequest.data.payload
      const assignment = options.assignments?.inspect(payload.bindingId as string)
      if (
        !assignment ||
        assignment.status !== 'ready' ||
        !matchesAssignment(assignment, {
          hostId: input.hostId,
          providerId: input.providerId,
          workspaceBindingId: envelope.scope.id,
          generation: envelope.generation,
          payloadGeneration: payload.generation,
        })
      ) {
        throw gatewayInvocationError('stale_generation')
      }
      if (!options.authorizeInvocation?.({ hostId: input.hostId, envelope, payload })) {
        throw gatewayInvocationError('operation_unauthorized')
      }
      if (
        options.contributions &&
        !options.contributions.isCallable({
          hostId: input.hostId,
          packageId: envelope.selectedContribution.packageId,
          contributionId: envelope.selectedContribution.contributionId,
          providerId: input.providerId,
        })
      ) {
        throw gatewayInvocationError('host_contribution_mismatch')
      }
      const attempt = [...attempts.values()].find((candidate) =>
        matchesCancellation(candidate, input.hostId, envelope, payload)
      )
      if (!attempt) throw gatewayInvocationError('cancellation_mismatch')
      const target = hostSockets.get(attempt.hostId)
      if (!target || target.readyState !== WebSocket.OPEN) {
        throw gatewayInvocationError('host_authentication_required')
      }
      target.send(
        JSON.stringify({
          version: 1,
          type: 'host.invocation.cancel',
          invocationId: attempt.envelope.invocationId,
          attemptId: payload.attemptId,
          generation: envelope.generation,
          reason: payload.reason,
          envelope,
          payload,
        })
      )
      return { accepted: true }
    },
  }

  return { clientWebSocketServer, hostWebSocketServer, hostControl }
}

async function handleHostFrame(
  socket: WebSocket,
  principal: { kind: 'desktop-host'; id: string },
  serialized: string,
  assignments: ActiveHostAssignmentService | undefined,
  attempts: Map<string, LiveAttempt>,
  resultAttempts: Map<string, LiveResultAttempt>,
  contributions: HostContributionRegistry | undefined,
  kernel: { effectiveGraph(): KernelGraph } | undefined
): Promise<void> {
  let frame: unknown
  try {
    frame = JSON.parse(serialized)
  } catch {
    socket.close(1008, 'invalid_host_frame')
    return
  }
  if (isInvocationEventFrame(frame)) {
    acceptInvocationEvent(socket, principal, frame.event, attempts, assignments)
    return
  }
  if (isInvocationResultFrame(frame)) {
    acceptInvocationResult(socket, principal, frame, resultAttempts, assignments)
    return
  }
  if (isContributionRegistrationFrame(frame) && contributions && kernel) {
    const registration = frame.registration
    const identity = `${String(registration.packageId)}:${String(registration.contributionId)}`
    const providerId = registration.providerId
    const readiness = registration.readiness as ProviderReadiness | null
    try {
      if (typeof providerId !== 'string' || !readiness) throw new Error('invalid_host_registration')
      contributions.loadFromKernel(
        principal,
        kernel,
        { [identity]: providerId },
        { [identity]: readiness }
      )
      if (
        !contributions.isCallable({
          hostId: principal.id,
          packageId: String(registration.packageId),
          contributionId: String(registration.contributionId),
          providerId,
        })
      )
        throw new Error('invalid_host_registration')
      return
    } catch {
      socket.close(1008, 'invalid_host_registration')
      return
    }
  }
  if (!assignments || !isReadinessFrame(frame)) {
    socket.close(1008, 'invalid_host_frame')
    return
  }
  try {
    await assignments.reportReadiness(principal, {
      bindingId: frame.bindingId,
      providerId: frame.providerId,
      workspaceBindingId: frame.workspaceBindingId,
      ready: frame.ready,
    })
    socket.send(
      JSON.stringify({
        version: 1,
        type: 'host.readiness.accepted',
        bindingId: frame.bindingId,
        providerId: frame.providerId,
        workspaceBindingId: frame.workspaceBindingId,
      })
    )
  } catch {
    socket.close(1008, 'invalid_host_frame')
  }
}

function acceptInvocationResult(
  socket: WebSocket,
  principal: { kind: 'desktop-host'; id: string },
  frame: { invocationId: string; generation: number; result: unknown },
  attempts: Map<string, LiveResultAttempt>,
  assignments: ActiveHostAssignmentService | undefined
): void {
  const attempt = attempts.get(frame.invocationId)
  const assignment =
    attempt &&
    assignments?.find({
      hostId: attempt.hostId,
      providerId: attempt.providerId,
      workspaceBindingId: attempt.envelope.scope.id as string,
    })
  const parsed = attempt
    ? parseHarnessExecutionResult(attempt.envelope.operation, frame.result)
    : undefined
  if (
    !attempt ||
    attempt.hostId !== principal.id ||
    !assignment ||
    assignment.status !== 'ready' ||
    assignment.generation !== attempt.envelope.generation ||
    frame.generation !== attempt.envelope.generation ||
    !parsed?.success
  ) {
    if (attempt) {
      attempts.delete(frame.invocationId)
      attempt.reject(gatewayInvocationError('invalid_host_output'))
    }
    socket.close(1008, 'invalid_invocation_result')
    return
  }
  attempts.delete(frame.invocationId)
  attempt.resolve({ result: parsed.data })
}

function acceptInvocationEvent(
  socket: WebSocket,
  principal: { kind: 'desktop-host'; id: string },
  event: HarnessExecutionEvent,
  attempts: Map<string, LiveAttempt>,
  assignments: ActiveHostAssignmentService | undefined
): void {
  const attempt = attempts.get(event.invocationId)
  if (!attempt || attempt.hostId !== principal.id) {
    socket.close(1008, 'invalid_invocation_event')
    return
  }
  const request = attempt.payload
  let currentAssignment
  try {
    currentAssignment = assignments?.inspect(request.bindingId as string)
  } catch {
    currentAssignment = undefined
  }
  if (
    !currentAssignment ||
    currentAssignment.status !== 'ready' ||
    !matchesAssignment(currentAssignment, {
      hostId: attempt.hostId,
      providerId: attempt.providerId,
      workspaceBindingId: attempt.envelope.scope.id,
      generation: attempt.envelope.generation,
    })
  ) {
    attempt.reject(gatewayInvocationError('stale_generation'))
    attempts.delete(event.invocationId)
    socket.close(1008, 'stale_generation')
    return
  }
  if (
    event.bindingId !== request.bindingId ||
    event.threadId !== request.threadId ||
    event.turnId !== request.turnId ||
    event.attemptId !== request.attemptId ||
    event.generation !== attempt.envelope.generation
  ) {
    attempt.reject(gatewayInvocationError('invalid_host_output'))
    attempts.delete(event.invocationId)
    socket.close(1008, 'invalid_invocation_event')
    return
  }
  if (event.kind !== 'terminal') {
    const boundary = validateHostRpcOutput({ class: event.kind, content: event.payload })
    if (!boundary.accepted) {
      attempt.reject(gatewayInvocationError('invalid_host_output'))
      attempts.delete(event.invocationId)
      socket.close(1008, 'invalid_invocation_event')
      return
    }
  }
  const fenced = attempt.fence.accept(event)
  if (!fenced.accepted) {
    attempt.reject(gatewayInvocationError(fenced.code))
    attempts.delete(event.invocationId)
    socket.close(1008, 'invalid_invocation_event')
    return
  }
  attempt.events.push(structuredClone(event))
  if (event.kind !== 'terminal') attempt.disconnect.acceptPublicEvent(event)
  attempt.onEvent(structuredClone(event))
  if (event.kind === 'terminal') {
    attempts.delete(event.invocationId)
    attempt.resolve({ events: attempt.events })
  }
}

function matchesAssignment(
  assignment: {
    hostId: string
    providerId?: string
    workspaceBindingId?: string
    generation: number
  },
  expected: {
    hostId: string
    providerId: string
    workspaceBindingId?: string
    generation: number
    payloadGeneration?: unknown
  }
): boolean {
  return (
    assignment.hostId === expected.hostId &&
    assignment.providerId === expected.providerId &&
    assignment.workspaceBindingId === expected.workspaceBindingId &&
    assignment.generation === expected.generation &&
    (typeof expected.payloadGeneration !== 'number' ||
      expected.payloadGeneration === assignment.generation)
  )
}

function matchesCancellation(
  attempt: LiveAttempt,
  hostId: string,
  envelope: KernelInvocationEnvelope,
  payload: Record<string, unknown>
): boolean {
  const selected = attempt.envelope.selectedContribution
  return (
    attempt.hostId === hostId &&
    attempt.envelope.principal.id === envelope.principal.id &&
    selected.packageId === envelope.selectedContribution.packageId &&
    selected.contributionId === envelope.selectedContribution.contributionId &&
    attempt.payload.bindingId === payload.bindingId &&
    attempt.payload.threadId === payload.threadId &&
    attempt.payload.turnId === payload.turnId &&
    attempt.payload.attemptId === payload.attemptId &&
    attempt.payload.generation === payload.generation
  )
}

function gatewayInvocationError(
  code: ConstructorParameters<typeof HarnessExecutionConnectionError>[0]
) {
  return new HarnessExecutionConnectionError(code, `Desktop Host gateway rejected ${code}`)
}

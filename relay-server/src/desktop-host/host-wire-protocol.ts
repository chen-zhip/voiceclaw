import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { parseHarnessExecutionStream, type HarnessExecutionEvent } from '@voiceclaw/contracts'
import type { DesktopHostConnectionGateway } from './host-connection.js'

export async function admitHostUpgrade(
  request: IncomingMessage,
  gateway: DesktopHostConnectionGateway
) {
  const protocols = (request.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((protocol) => protocol.trim())
  if (!protocols.includes('voiceclaw.host.v1')) return Promise.reject(400)

  const localSecret = readSingleHeader(request, 'x-voiceclaw-local-host-bootstrap')
  const stackId = readSingleHeader(request, 'x-voiceclaw-local-host-stack-id')
  if (localSecret !== undefined || stackId !== undefined) {
    if (!localSecret || !stackId || request.headers.authorization !== undefined) {
      return Promise.reject(401)
    }
    try {
      return await gateway.admit({
        mode: 'local',
        stackId,
        credential: { kind: 'local-bootstrap', value: localSecret },
      })
    } catch {
      return Promise.reject(401)
    }
  }

  const match = /^Host ([^\s]+)$/.exec(request.headers.authorization ?? '')
  if (!match) return Promise.reject(401)
  try {
    return await gateway.admit({
      mode: 'remote',
      credential: { kind: 'host', value: match[1] },
    })
  } catch {
    return Promise.reject(401)
  }
}

export function isInvocationEventFrame(value: unknown): value is {
  version: 1
  type: 'host.invocation.event'
  event: HarnessExecutionEvent
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const frame = value as Record<string, unknown>
  if (
    Object.keys(frame).sort().join('\0') !== ['event', 'type', 'version'].sort().join('\0') ||
    frame.version !== 1 ||
    frame.type !== 'host.invocation.event'
  )
    return false
  const event = frame.event as HarnessExecutionEvent
  if (typeof event !== 'object' || event === null) return false
  const validation =
    event.kind === 'terminal'
      ? parseHarnessExecutionStream([event])
      : parseHarnessExecutionStream([
          event,
          {
            ...event,
            sequence: event.sequence + 1,
            kind: 'terminal',
            payload: { outcome: 'completed' },
          },
        ])
  return validation.success
}

export function isInvocationResultFrame(value: unknown): value is {
  version: 1
  type: 'host.invocation.result'
  invocationId: string
  generation: number
  result: unknown
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const frame = value as Record<string, unknown>
  return (
    Object.keys(frame).sort().join('\0') ===
      ['generation', 'invocationId', 'result', 'type', 'version'].sort().join('\0') &&
    frame.version === 1 &&
    frame.type === 'host.invocation.result' &&
    typeof frame.invocationId === 'string' &&
    Number.isSafeInteger(frame.generation)
  )
}

export function isReadinessFrame(value: unknown): value is {
  version: 1
  type: 'host.readiness.report'
  bindingId: string
  providerId: string
  workspaceBindingId: string
  ready: boolean
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const frame = value as Record<string, unknown>
  const keys = Object.keys(frame).sort()
  const expected = [
    'bindingId',
    'providerId',
    'ready',
    'type',
    'version',
    'workspaceBindingId',
  ].sort()
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]) &&
    frame.version === 1 &&
    frame.type === 'host.readiness.report' &&
    typeof frame.bindingId === 'string' &&
    typeof frame.providerId === 'string' &&
    typeof frame.workspaceBindingId === 'string' &&
    typeof frame.ready === 'boolean'
  )
}

export function isContributionRegistrationFrame(value: unknown): value is {
  version: 1
  type: 'host.contribution.register'
  registration: Record<string, unknown>
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const frame = value as Record<string, unknown>
  return (
    Object.keys(frame).sort().join('\0') ===
      ['registration', 'type', 'version'].sort().join('\0') &&
    frame.version === 1 &&
    frame.type === 'host.contribution.register' &&
    typeof frame.registration === 'object' &&
    frame.registration !== null &&
    !Array.isArray(frame.registration)
  )
}

export function rejectHostUpgrade(socket: Duplex, statusCode: number, reason: string): void {
  if (socket.destroyed) return
  socket.end(`HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

function readSingleHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? undefined : value
}

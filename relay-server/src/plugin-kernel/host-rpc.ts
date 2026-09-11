import {
  isProviderNeutralValue,
  parseKernelInvocationEnvelope,
  type KernelInvocationEnvelope,
} from '@voiceclaw/contracts'

export class HostRpcError extends Error {
  constructor(
    readonly code: 'invalid_request' | 'authorization_denied',
    message: string
  ) {
    super(message)
    this.name = 'HostRpcError'
  }
}

export async function startHostRpcInvocation(options: {
  envelope: unknown
  payload: unknown
  authorize(envelope: KernelInvocationEnvelope): boolean
  dispatch(message: unknown): Promise<void>
}) {
  const parsed = parseKernelInvocationEnvelope(options.envelope)
  if (!parsed.success || !isProviderNeutralValue(options.payload)) {
    throw new HostRpcError(
      'invalid_request',
      'Host RPC request is not a valid provider-neutral invocation'
    )
  }
  if (!options.authorize(parsed.data)) {
    throw new HostRpcError('authorization_denied', 'Kernel Invocation Envelope is not authorized')
  }

  const correlation = {
    invocationId: parsed.data.invocationId,
    generation: parsed.data.generation,
  }
  await options.dispatch({
    kind: 'request',
    ...correlation,
    envelope: parsed.data,
    payload: structuredClone(options.payload),
  })

  return {
    stream(sequence: number, event: unknown) {
      if (!Number.isSafeInteger(sequence) || sequence < 1 || !isProviderNeutralValue(event)) {
        throw new HostRpcError('invalid_request', 'Host RPC stream event is invalid')
      }
      return {
        kind: 'stream' as const,
        ...correlation,
        sequence,
        event: structuredClone(event),
      }
    },
    cancel(reason: string) {
      if (reason.length === 0) {
        throw new HostRpcError('invalid_request', 'Cancellation reason is required')
      }
      return { kind: 'cancel' as const, ...correlation, reason }
    },
    terminal(outcome: unknown) {
      if (!isProviderNeutralValue(outcome)) {
        throw new HostRpcError('invalid_request', 'Host RPC terminal is invalid')
      }
      return {
        kind: 'terminal' as const,
        ...correlation,
        outcome: structuredClone(outcome),
      }
    },
  }
}

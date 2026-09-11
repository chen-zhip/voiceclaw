export type PrincipalKind = 'user' | 'client' | 'contribution' | 'relay-authority' | 'desktop-host'

export interface KernelInvocationEnvelope {
  contract: { id: string; version: string }
  operation: string
  invocationId: string
  principal: { kind: PrincipalKind; id: string }
  scope: { kind: string; id?: string }
  selectedContribution: { packageId: string; contributionId: string }
  generation: number
  trace: { traceId: string; parentSpanId?: string }
  cancellation: { supported: boolean; token?: string }
}

export type KernelFailureCode =
  | 'authorization_denied'
  | 'capability_unavailable'
  | 'invalid_request'
  | 'cancelled'
  | 'timeout'
  | 'provider_failure'
  | 'protocol_violation'
  | 'stale_generation'

export interface KernelFailure {
  code: KernelFailureCode
  message: string
  retryable: boolean
  details?: Record<string, unknown>
}

export type ContractParseResult<T> =
  | { success: true; data: T }
  | { success: false; errors: Array<{ path: string; code: string; message: string }> }

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const CONTRACT_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const OPERATION_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const PRINCIPAL_KINDS = new Set<PrincipalKind>([
  'user',
  'client',
  'contribution',
  'relay-authority',
  'desktop-host',
])
const FAILURE_CODES = new Set<KernelFailureCode>([
  'authorization_denied',
  'capability_unavailable',
  'invalid_request',
  'cancelled',
  'timeout',
  'provider_failure',
  'protocol_violation',
  'stale_generation',
])

export function parseKernelInvocationEnvelope(
  input: unknown
): ContractParseResult<KernelInvocationEnvelope> {
  const errors: Array<{ path: string; code: string; message: string }> = []
  const reject = (path: string, code = 'invalid_field') =>
    errors.push({ path, code, message: 'Kernel Invocation Envelope field is invalid' })
  if (
    !isExactRecord(input, [
      'contract',
      'operation',
      'invocationId',
      'principal',
      'scope',
      'selectedContribution',
      'generation',
      'trace',
      'cancellation',
    ])
  ) {
    return {
      success: false,
      errors: [
        {
          path: '$',
          code: 'invalid_fields',
          message: 'Kernel Invocation Envelope fields are invalid',
        },
      ],
    }
  }

  if (
    !isExactRecord(input.contract, ['id', 'version']) ||
    typeof input.contract.id !== 'string' ||
    !CONTRACT_PATTERN.test(input.contract.id) ||
    typeof input.contract.version !== 'string' ||
    !SEMVER_PATTERN.test(input.contract.version)
  )
    reject('contract')
  if (typeof input.operation !== 'string' || !OPERATION_PATTERN.test(input.operation))
    reject('operation')
  if (!isNonemptyString(input.invocationId)) reject('invocationId')
  if (
    !isExactRecord(input.principal, ['kind', 'id']) ||
    !PRINCIPAL_KINDS.has(input.principal.kind as PrincipalKind) ||
    !isNonemptyString(input.principal.id)
  )
    reject('principal')
  if (!isOptionalIdRecord(input.scope, 'kind') || !isNonemptyString(input.scope.kind))
    reject('scope')
  if (
    !isExactRecord(input.selectedContribution, ['packageId', 'contributionId']) ||
    !isNonemptyString(input.selectedContribution.packageId) ||
    !isNonemptyString(input.selectedContribution.contributionId)
  )
    reject('selectedContribution')
  if (!Number.isSafeInteger(input.generation) || (input.generation as number) < 0)
    reject('generation')
  if (
    !isOptionalIdRecord(input.trace, 'traceId', 'parentSpanId') ||
    !isNonemptyString(input.trace.traceId)
  )
    reject('trace')
  if (
    !isOptionalIdRecord(input.cancellation, 'supported', 'token') ||
    typeof input.cancellation.supported !== 'boolean' ||
    (input.cancellation.token !== undefined && !isNonemptyString(input.cancellation.token))
  )
    reject('cancellation')

  return errors.length > 0
    ? { success: false, errors }
    : { success: true, data: input as unknown as KernelInvocationEnvelope }
}

export function parseKernelFailure(input: unknown): ContractParseResult<KernelFailure> {
  if (!isRecord(input)) return invalidFailure()
  const keys =
    input.details === undefined
      ? ['code', 'message', 'retryable']
      : ['code', 'message', 'retryable', 'details']
  if (
    !hasExactKeys(input, keys) ||
    !FAILURE_CODES.has(input.code as KernelFailureCode) ||
    !isNonemptyString(input.message) ||
    typeof input.retryable !== 'boolean' ||
    (input.details !== undefined && !isRecord(input.details))
  ) {
    return invalidFailure()
  }
  return { success: true, data: input as unknown as KernelFailure }
}

function invalidFailure(): ContractParseResult<KernelFailure> {
  return {
    success: false,
    errors: [{ path: '$', code: 'invalid_failure', message: 'Kernel failure is invalid' }],
  }
}

function isOptionalIdRecord(
  value: unknown,
  requiredKey: string,
  optionalKey = 'id'
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    hasExactKeys(
      value,
      value[optionalKey] === undefined ? [requiredKey] : [requiredKey, optionalKey]
    )
  )
}

import { hasExactKeys, isExactRecord, isNonemptyString, isRecord } from './validation.js'

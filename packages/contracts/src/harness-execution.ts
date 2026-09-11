import type { ContractParseResult } from './kernel-invocation.js'
import { isProviderNeutralValue } from './provider-neutral.js'
import { hasExactKeys, isExactRecord, isNonemptyString, isRecord } from './validation.js'

export const HARNESS_EXECUTION_CONTRACT = {
  id: 'harness.execution',
  version: '1.0.0',
  operations: ['provider.describe', 'thread.ensure', 'turn.start', 'turn.cancel'],
} as const

export type HarnessExecutionOperation = (typeof HARNESS_EXECUTION_CONTRACT.operations)[number]

export interface HarnessExecutionEvent {
  invocationId: string
  bindingId: string
  threadId: string
  turnId: string
  attemptId: string
  generation: number
  sequence: number
  kind: 'semantic-output' | 'presentation-state' | 'outcome-evidence' | 'diagnostic' | 'terminal'
  payload: Record<string, unknown>
}

export function parseHarnessExecutionRequest(
  input: unknown
): ContractParseResult<{ operation: HarnessExecutionOperation; payload: Record<string, unknown> }> {
  if (!isExactRecord(input, ['operation', 'payload']) || !isRecord(input.payload))
    return invalid('Invalid harness.execution request')
  const operation = input.operation
  const payload = input.payload
  let valid = false
  if (operation === 'provider.describe') valid = hasExactKeys(payload, [])
  if (operation === 'thread.ensure')
    valid = hasStringFields(payload, ['bindingId', 'workspaceBindingId', 'conversationId'])
  if (operation === 'turn.start') {
    valid =
      isExactRecord(payload, [
        'bindingId',
        'threadId',
        'turnId',
        'attemptId',
        'generation',
        'input',
      ]) &&
      hasNonemptyStrings(payload, ['bindingId', 'threadId', 'turnId', 'attemptId']) &&
      isGeneration(payload.generation) &&
      isExactRecord(payload.input, ['text']) &&
      isNonemptyString(payload.input.text)
  }
  if (operation === 'turn.cancel') {
    valid =
      isExactRecord(payload, [
        'bindingId',
        'threadId',
        'turnId',
        'attemptId',
        'generation',
        'reason',
      ]) &&
      hasNonemptyStrings(payload, ['bindingId', 'threadId', 'turnId', 'attemptId', 'reason']) &&
      isGeneration(payload.generation)
  }
  return valid && isProviderNeutralValue(payload)
    ? {
        success: true,
        data: input as { operation: HarnessExecutionOperation; payload: Record<string, unknown> },
      }
    : invalid('Invalid harness.execution operation payload')
}

export function parseHarnessExecutionStream(
  input: unknown
): ContractParseResult<HarnessExecutionEvent[]> {
  if (!Array.isArray(input) || input.length === 0) return invalid('Harness stream is empty')
  const events: HarnessExecutionEvent[] = []
  for (const value of input) {
    if (!isHarnessExecutionEvent(value)) return invalid('Harness stream event is invalid')
    events.push(value)
  }
  const first = events[0]
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (
      event.invocationId !== first.invocationId ||
      event.bindingId !== first.bindingId ||
      event.threadId !== first.threadId ||
      event.turnId !== first.turnId ||
      event.attemptId !== first.attemptId ||
      event.generation !== first.generation ||
      (index > 0 && event.sequence <= events[index - 1].sequence)
    ) {
      return invalid('Harness stream correlation or sequence is invalid')
    }
  }
  const terminalIndexes = events
    .map((event, index) => (event.kind === 'terminal' ? index : -1))
    .filter((index) => index >= 0)
  if (terminalIndexes.length !== 1 || terminalIndexes[0] !== events.length - 1) {
    return invalid('Harness stream requires exactly one final terminal outcome')
  }
  return { success: true, data: input }
}

export function parseHarnessExecutionResult(
  operation: string,
  input: unknown
): ContractParseResult<Record<string, unknown>> {
  if (
    operation === 'turn.start' ||
    !HARNESS_EXECUTION_CONTRACT.operations.includes(operation as HarnessExecutionOperation) ||
    !isRecord(input) ||
    !isProviderNeutralValue(input)
  ) {
    return invalid('Harness operation result is invalid')
  }
  return { success: true, data: input }
}

function isHarnessExecutionEvent(value: unknown): value is HarnessExecutionEvent {
  if (
    !isExactRecord(value, [
      'invocationId',
      'bindingId',
      'threadId',
      'turnId',
      'attemptId',
      'generation',
      'sequence',
      'kind',
      'payload',
    ])
  )
    return false
  if (!hasNonemptyStrings(value, ['invocationId', 'bindingId', 'threadId', 'turnId', 'attemptId']))
    return false
  if (
    !isGeneration(value.generation) ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1
  )
    return false
  const kinds = new Set([
    'semantic-output',
    'presentation-state',
    'outcome-evidence',
    'diagnostic',
    'terminal',
  ])
  if (
    !kinds.has(value.kind as string) ||
    !isRecord(value.payload) ||
    !isProviderNeutralValue(value.payload)
  )
    return false
  if (value.kind === 'terminal') {
    return (
      isExactRecord(value.payload, ['outcome']) &&
      new Set(['completed', 'failed', 'cancelled', 'unknown']).has(value.payload.outcome as string)
    )
  }
  return true
}

function invalid<T>(message: string): ContractParseResult<T> {
  return { success: false, errors: [{ path: '$', code: 'invalid_harness_execution', message }] }
}

function hasStringFields(value: Record<string, unknown>, keys: string[]): boolean {
  return isExactRecord(value, keys) && hasNonemptyStrings(value, keys)
}

function hasNonemptyStrings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => isNonemptyString(value[key]))
}

function isGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

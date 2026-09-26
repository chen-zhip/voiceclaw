import { isRecord } from '@voiceclaw/contracts'

export type CodexFailureClass =
  | 'configuration'
  | 'executable'
  | 'process'
  | 'transport'
  | 'protocol'
  | 'authorization'
  | 'workspace'
  | 'cancellation'
  | 'provider-execution'

export interface CodexFailure {
  class: CodexFailureClass
  code: string
}

export type CodexFailureSignal =
  | { kind: 'json-rpc'; method: string; code: number }
  | { kind: 'provider-error'; codexErrorInfo?: unknown }
  | { kind: 'transport-closed' }
  | { kind: 'process-exit' }
  | { kind: 'executable-missing' }
  | { kind: 'workspace-denied' }
  | { kind: 'interrupted' }
  | { kind: 'stalled' }

const CONNECTION_ERROR_INFO_KEYS = [
  'httpConnectionFailed',
  'responseStreamConnectionFailed',
  'responseStreamDisconnected',
  'responseTooManyFailedAttempts',
]

export function classifyCodexFailure(signal: CodexFailureSignal): CodexFailure {
  switch (signal.kind) {
    case 'transport-closed':
      return { class: 'transport', code: 'codex_transport_lost' }
    case 'process-exit':
      return { class: 'process', code: 'codex_process_failed' }
    case 'executable-missing':
      return { class: 'executable', code: 'codex_executable_unavailable' }
    case 'workspace-denied':
      return { class: 'workspace', code: 'codex_workspace_unavailable' }
    case 'interrupted':
      return { class: 'cancellation', code: 'codex_turn_cancelled' }
    case 'stalled':
      return { class: 'transport', code: 'codex_turn_stalled' }
    case 'json-rpc':
      if (signal.code === -32602 || signal.code === -32600) {
        return { class: 'configuration', code: 'codex_configuration_invalid' }
      }
      return { class: 'protocol', code: 'codex_protocol_incompatible' }
    case 'provider-error':
      if (signal.codexErrorInfo === 'unauthorized') {
        return { class: 'authorization', code: 'codex_authorization_unavailable' }
      }
      if (
        isRecord(signal.codexErrorInfo) &&
        CONNECTION_ERROR_INFO_KEYS.some((key) => key in signal.codexErrorInfo!)
      ) {
        return { class: 'transport', code: 'codex_transport_lost' }
      }
      return { class: 'provider-execution', code: 'codex_turn_failed' }
  }
}

export function codexOutcomeForFailure(failure: CodexFailure): 'failed' | 'cancelled' | 'unknown' {
  if (failure.class === 'cancellation') return 'cancelled'
  if (failure.class === 'transport') return 'unknown'
  return 'failed'
}

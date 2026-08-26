// Capabilities are declared up front rather than probed, so the relay can pick
// its degradation path before a turn starts instead of handling a mid-stream
// failure.

import type {
  ChunkHandler,
  InterruptionContext,
  OverlayContext,
  OverlayResponse,
  StreamHandle,
  UserMessage,
} from './types.js'

export interface HarnessCapabilities {
  /**
   * true      — emits thinking/speech/text as separate fields.
   * "partial" — emits some fields; the router fills the rest by fallback.
   * false     — plain text only; treated entirely as speech.
   */
  structuredOutput: boolean | 'partial'
  /** Can resume with interruption context instead of cancel-and-restart. */
  interruption: boolean
  /** Can answer a side query without disturbing the main stream. */
  overlay: boolean
  /** Emits incremental chunks rather than one final payload. */
  streaming: boolean
}

export interface HarnessConfig {
  /** Base URL when the Harness is reachable over HTTP. */
  gatewayUrl?: string
  authToken?: string
  sessionId?: string
  /** Extra system-prompt text appended after the structured-output contract. */
  instructions?: string
  timeoutMs?: number
}

export interface HarnessAdapter {
  readonly id: string

  readonly capabilities: HarnessCapabilities

  connect(config: HarnessConfig): Promise<void>

  sendMessage(msg: UserMessage, onChunk: ChunkHandler): Promise<StreamHandle>

  /** Present only when capabilities.interruption is true. */
  interrupt?(handle: StreamHandle, ctx: InterruptionContext): Promise<StreamHandle>

  /** Present only when capabilities.overlay is true. */
  overlayQuery?(query: string, ctx: OverlayContext): Promise<OverlayResponse>

  disconnect(): Promise<void>
}

// Structured output protocol shared by Harness adapters and the output router.
//
// A compliant Harness returns three separable streams per turn:
//   thinking — internal reasoning. Stored locally + traced, never sent to a client.
//   speech   — concise verbal summary. Goes to TTS.
//   text     — detailed screen content. Goes to the client as transcript.
//
// Only `speech` is required. Non-compliant Harnesses return plain text, which
// adapters treat as speech (see parseStructuredOutput).

export type TextFormat = 'markdown' | 'plain' | 'code'

export interface ScreenReference {
  /** Character offset into speech content where the reference applies. */
  at: number
  type: 'look' | 'highlight'
  /** Matches a TextSection id. */
  target: string
}

export interface TextSection {
  id: string
  title?: string
  content: string
}

export interface ThinkingContent {
  steps: string[]
  reasoning: string
  /** 0–1 self-reported confidence. */
  confidence?: number
}

export interface SpeechContent {
  content: string
  emotion?: string
  speed?: number
  screenReferences?: ScreenReference[]
}

export interface TextContent {
  content: string
  format?: TextFormat
  language?: string
  sections?: TextSection[]
}

export interface StructuredOutput {
  thinking?: ThinkingContent
  speech: SpeechContent
  text?: TextContent
}

/** Incremental chunks streamed out of a Harness adapter. */
export type OutputChunk =
  | { type: 'thinking.delta'; content: string }
  | {
      type: 'speech.delta'
      content: string
      emotion?: string
      speed?: number
      screenReferences?: ScreenReference[]
    }
  | {
      type: 'text.delta'
      content: string
      format?: TextFormat
      language?: string
      sections?: TextSection[]
    }
  | { type: 'complete'; output?: StructuredOutput }

export type ChunkHandler = (chunk: OutputChunk) => void | Promise<void>

export interface UserMessage {
  text: string
  turnId?: string
}

export interface StreamHandle {
  /** Abort the in-flight request; no further chunks are emitted. */
  cancel(): void
  /** Resolves when the stream finishes or is cancelled. */
  done: Promise<void>
}

export interface InterruptionContext {
  /** What the user had already heard when they cut in. */
  spokenSoFar: string
  interruptionText: string
}

export interface OverlayContext {
  turnId?: string
  signal?: AbortSignal
}

export interface OverlayResponse {
  content: string
}

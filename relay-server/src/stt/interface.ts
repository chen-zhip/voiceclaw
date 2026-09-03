export interface STTConfig {
  apiKey?: string
  model?: string
  language?: string
  sampleRate?: number
  /** Silence duration that ends an utterance and triggers a final transcript. */
  endpointingMs?: number
}

export type TranscriptCallback = (text: string) => void

export interface STTProvider {
  connect(config: STTConfig): Promise<void>

  /** Feed base64 PCM16 from the client into the recognizer. */
  processAudio(pcmData: string): void

  /**
   * Signal end of the client's audio buffer. Providers with server-side
   * endpointing may ignore this; those without use it to force a final result.
   */
  commit(): void

  /** Interim hypotheses — safe to show, never sent to the Harness. */
  onPartialTranscript(callback: TranscriptCallback): void

  /** Stable utterance text. This is what gets forwarded to the Harness. */
  onFinalTranscript(callback: TranscriptCallback): void

  onError(callback: (message: string) => void): void

  disconnect(): Promise<void>
}

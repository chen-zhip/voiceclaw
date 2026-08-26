// Synthesis is an async generator so the relay can forward audio to the client
// as it arrives instead of buffering a whole utterance.

export interface TTSConfig {
  apiKey?: string
  voice?: string
  model?: string
  sampleRate?: number
  speed?: number
  /**
   * Complete sentences buffered before a synthesis request is issued.
   * Smaller = lower time-to-first-audio; larger = more cross-sentence context
   * for prosody. Clamped to MAX_SENTENCE_BATCH_SIZE by the output router.
   */
  sentenceBatchSize?: number
}

export interface AudioChunk {
  /** base64 PCM16 little-endian at the configured sample rate. */
  data: string
}

export interface SynthesizeOptions {
  /** Prosody hint from structured output; providers may ignore it. */
  emotion?: string
  speed?: number
}

export interface TTSProvider {
  connect(config: TTSConfig): Promise<void>

  synthesize(text: string, options?: SynthesizeOptions): AsyncIterable<AudioChunk>

  /**
   * Characters of submitted text already emitted as audio. Used to line up
   * screen references with what the user has actually heard.
   */
  getPlaybackPosition(): number

  /** Abort in-flight synthesis (barge-in, session teardown). */
  stop(): Promise<void>

  disconnect(): Promise<void>
}

import { clampSentenceBatchSize } from '../tts/index.js'
import type { TTSProvider } from '../tts/interface.js'
import type { SttTtsDebugFields, SttTtsDebugRecorder } from '../stt-tts-debug.js'

export interface HarnessSpeechDeliveryOptions {
  tts: TTSProvider
  sentenceBatchSize?: number
  sendToClient(
    event: { type: 'audio.delta'; data: string } | { type: 'harness.tts-failed'; message: string }
  ): void
  warn?: (message: string) => void
  debugRecorder?: SttTtsDebugRecorder
  debugContext?: () => Partial<
    Pick<SttTtsDebugFields, 'sessionId' | 'turnId' | 'attemptId' | 'providerId'>
  >
}

export class HarnessSpeechDelivery {
  readonly #sentenceBatchSize: number
  #buffer = ''
  #sentences: string[] = []
  #synthesisTail: Promise<void> = Promise.resolve()
  #aborted = false

  constructor(private readonly options: HarnessSpeechDeliveryOptions) {
    this.#sentenceBatchSize = clampSentenceBatchSize(options.sentenceBatchSize)
  }

  async write(text: string): Promise<void> {
    if (this.#aborted) return
    this.#buffer += text
    this.#sentences.push(...this.#takeCompleteSentences())
    while (this.#sentences.length >= this.#sentenceBatchSize) {
      await this.#synthesize(this.#sentences.splice(0, this.#sentenceBatchSize).join(' '))
    }
  }

  async finish(): Promise<void> {
    if (this.#aborted) return
    const trailing = this.#buffer.trim()
    this.#buffer = ''
    if (trailing) this.#sentences.push(trailing)
    while (this.#sentences.length > 0) {
      await this.#synthesize(this.#sentences.splice(0, this.#sentenceBatchSize).join(' '))
    }
    await this.#synthesisTail
  }

  /**
   * Cancellation stops waiting on in-flight synthesis. Public audio already
   * emitted is preserved; nothing further is submitted.
   */
  abort(): void {
    this.#aborted = true
    this.options.debugRecorder?.record('tts.synthesis.cancelled', {
      stage: 'tts',
      ...this.options.debugContext?.(),
      reason: 'delivery aborted',
    })
    this.#buffer = ''
    this.#sentences = []
    this.#synthesisTail = Promise.resolve()
  }

  #takeCompleteSentences(): string[] {
    const complete: string[] = []
    while (true) {
      const boundary = this.#buffer.search(/[.!?\n。！？]/)
      if (boundary < 0) return complete
      const sentence = this.#buffer.slice(0, boundary + 1).trim()
      this.#buffer = this.#buffer.slice(boundary + 1)
      if (sentence) complete.push(sentence)
    }
  }

  #synthesize(text: string): Promise<void> {
    const task = this.#synthesisTail.then(async () => {
      if (this.#aborted) return
      const startedAt = Date.now()
      const context = this.options.debugContext?.() ?? {}
      this.options.debugRecorder?.record('tts.synthesis.start', {
        stage: 'tts',
        ...context,
        synthesisText: text,
        synthesisCharacters: text.length,
      })
      let chunkCount = 0
      let audioBytes = 0
      try {
        for await (const chunk of this.options.tts.synthesize(text)) {
          if (this.#aborted) return
          chunkCount += 1
          audioBytes += Buffer.from(chunk.data, 'base64').length
          this.options.sendToClient({ type: 'audio.delta', data: chunk.data })
        }
        this.options.debugRecorder?.record('tts.synthesis.complete', {
          stage: 'tts',
          ...context,
          durationMs: Math.max(0, Date.now() - startedAt),
          chunkCount,
          audioBytes,
        })
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error)
        this.options.debugRecorder?.record('tts.synthesis.failed', {
          stage: 'tts',
          ...context,
          durationMs: Math.max(0, Date.now() - startedAt),
          error: detail,
        })
        this.options.warn?.(
          `TTS synthesis failed; public audio already emitted was preserved: ${detail}`
        )
        this.options.sendToClient({
          type: 'harness.tts-failed',
          message: 'Speech playback unavailable. Check the configured TTS service, then retry.',
        })
      }
    })
    this.#synthesisTail = task
    return task
  }
}

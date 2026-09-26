import { clampSentenceBatchSize } from '../tts/index.js'
import type { TTSProvider } from '../tts/interface.js'

export interface HarnessSpeechDeliveryOptions {
  tts: TTSProvider
  sentenceBatchSize?: number
  sendToClient(event: { type: 'audio.delta'; data: string }): void
  warn?: (message: string) => void
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
    const task = this.#synthesisTail
      .then(async () => {
        if (this.#aborted) return
        for await (const chunk of this.options.tts.synthesize(text)) {
          if (this.#aborted) return
          this.options.sendToClient({ type: 'audio.delta', data: chunk.data })
        }
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        this.options.warn?.(
          `TTS synthesis failed; public audio already emitted was preserved: ${detail}`
        )
      })
    this.#synthesisTail = task
    return task
  }
}

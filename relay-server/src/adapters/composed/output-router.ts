import type { SendToClient } from '../types.js'
import type { OutputChunk, ScreenReference } from '../../harness-adapter/types.js'
import type { SynthesizeOptions, TTSProvider } from '../../tts/interface.js'
import type { ThinkingContent } from '../../harness-adapter/types.js'
import type { ThinkingEntry, ThinkingSaveMetadata } from '../../thinking/storage.js'
import { clampSentenceBatchSize } from '../../tts/index.js'
import { warn as logWarning } from '../../log.js'

export interface OutputRouteContext {
  sessionId: string
  turnId: string
  userQuery: string
}

export interface OutputRouterDependencies {
  tts: TTSProvider
  sendToClient: SendToClient
  saveThinking?: (entry: ThinkingEntry) => Promise<ThinkingSaveMetadata | null>
  attachThinkingContent?: (content: ThinkingContent, turnId: string) => void
  sentenceBatchSize?: number
  warn?: (message: string) => void
}

export class OutputRouter {
  private speechBuffer = ''
  private sentenceQueue: string[] = []
  private synthesisTail: Promise<void> = Promise.resolve()
  private speechCharacters = 0
  private pendingScreenReferences: Array<ScreenReference & { at: number }> = []
  private currentProsody: SynthesizeOptions | undefined
  private thinkingBuffer = ''
  private turnSpeech = ''
  private turnText = ''
  private readonly sentenceBatchSize: number

  constructor(private readonly dependencies: OutputRouterDependencies) {
    this.sentenceBatchSize = clampSentenceBatchSize(dependencies.sentenceBatchSize)
  }

  async route(chunk: OutputChunk, context?: OutputRouteContext): Promise<void> {
    switch (chunk.type) {
      case 'thinking.delta':
        this.routeThinking(chunk.content)
        break
      case 'speech.delta':
        await this.routeSpeech(chunk)
        break
      case 'text.delta':
        this.routeText(chunk)
        break
      case 'complete':
        await this.completeTurn(chunk, context)
        break
    }
  }

  private routeThinking(content: string): void {
    this.thinkingBuffer += content
  }

  private async routeSpeech(chunk: Extract<OutputChunk, { type: 'speech.delta' }>): Promise<void> {
    const nextSpeechCharacters = this.speechCharacters + chunk.content.length
    if (this.speechCharacters <= 500 && nextSpeechCharacters > 500) {
      this.warn(
        `Speech content exceeds the 500 character listening limit (${nextSpeechCharacters})`
      )
    }
    if (this.containsDetailedStructure(chunk.content)) {
      this.warn('structured table or code content was preserved in speech output')
    }
    if (chunk.emotion || chunk.speed !== undefined) {
      this.currentProsody = {
        ...(chunk.emotion ? { emotion: chunk.emotion } : {}),
        ...(chunk.speed !== undefined ? { speed: chunk.speed } : {}),
      }
    }
    this.turnSpeech += chunk.content
    if (chunk.emotion) {
      this.warn(`TTS provider may not support emotion hint: ${chunk.emotion}`)
    }
    const chunkStart = this.speechCharacters
    this.speechCharacters = nextSpeechCharacters
    this.pendingScreenReferences.push(
      ...(chunk.screenReferences ?? []).map((reference) => ({
        ...reference,
        at: chunkStart + reference.at,
      }))
    )
    if (chunk.content.length === 0) this.emitReachedScreenReferences()
    this.speechBuffer += chunk.content
    this.sentenceQueue.push(...this.takeCompleteSentences())
    await this.flushReadyBatches()
  }

  private routeText(chunk: Extract<OutputChunk, { type: 'text.delta' }>): void {
    this.turnText += chunk.content
    this.dependencies.sendToClient({
      type: 'transcript.delta',
      text: chunk.content,
      role: 'assistant',
      source: 'text',
      ...(chunk.format ? { format: chunk.format } : {}),
      ...(chunk.language ? { language: chunk.language } : {}),
    })
    for (const section of chunk.sections ?? []) {
      this.dependencies.sendToClient({
        type: 'text.section',
        sectionId: section.id,
        ...(section.title ? { title: section.title } : {}),
        content: section.content,
        ...(chunk.format ? { format: chunk.format } : {}),
        ...(chunk.language ? { language: chunk.language } : {}),
      })
    }
  }

  private async completeTurn(
    chunk: Extract<OutputChunk, { type: 'complete' }>,
    context?: OutputRouteContext
  ): Promise<void> {
    if (chunk.output && !chunk.output.text) {
      this.dependencies.sendToClient({
        type: 'transcript.delta',
        text: chunk.output.speech.content,
        role: 'assistant',
        source: 'text',
      })
    }
    const trailing = this.speechBuffer.trim()
    this.speechBuffer = ''
    if (trailing) this.sentenceQueue.push(trailing)
    if (this.sentenceQueue.length > 0) {
      const finalBatch = this.sentenceQueue.splice(0).join(' ')
      await this.synthesize(finalBatch)
    }
    const thinking = chunk.output?.thinking ?? this.parseStreamedThinking()
    if (thinking && context) {
      this.dependencies.attachThinkingContent?.(thinking, context.turnId)
      const finalOutput =
        chunk.output?.text?.content ??
        chunk.output?.speech.content ??
        (this.turnText || this.turnSpeech)
      void this.saveThinking(thinking, finalOutput, context)
    }
    this.resetTurnState()
    this.dependencies.sendToClient({ type: 'turn.ended' })
  }

  private async saveThinking(
    thinking: ThinkingContent,
    finalOutput: string,
    context: OutputRouteContext
  ): Promise<void> {
    if (!this.dependencies.saveThinking) return
    try {
      const metadata = await this.dependencies.saveThinking({
        sessionId: context.sessionId,
        turnId: context.turnId,
        timestamp: new Date().toISOString(),
        thinking,
        userQuery: context.userQuery,
        finalOutput,
      })
      if (!metadata) return
      this.dependencies.sendToClient({
        type: 'thinking.saved',
        turnId: context.turnId,
        ...metadata,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.warn(`Unable to save thinking entry: ${message}`)
    }
  }

  private parseStreamedThinking(): ThinkingContent | null {
    if (!this.thinkingBuffer.trim()) return null
    try {
      const value: unknown = JSON.parse(this.thinkingBuffer)
      if (
        typeof value !== 'object' ||
        value === null ||
        !('steps' in value) ||
        !Array.isArray(value.steps) ||
        !value.steps.every((step) => typeof step === 'string') ||
        !('reasoning' in value) ||
        typeof value.reasoning !== 'string'
      ) {
        return null
      }
      return {
        steps: value.steps,
        reasoning: value.reasoning,
        ...('confidence' in value && typeof value.confidence === 'number'
          ? { confidence: value.confidence }
          : {}),
      }
    } catch {
      return null
    }
  }

  private resetTurnState(): void {
    this.speechCharacters = 0
    this.pendingScreenReferences = []
    this.currentProsody = undefined
    this.thinkingBuffer = ''
    this.turnSpeech = ''
    this.turnText = ''
  }

  private takeCompleteSentences(): string[] {
    const sentences: string[] = []
    while (true) {
      const boundary = this.speechBuffer.search(/[.!?\n。！？]/)
      if (boundary < 0) return sentences
      const sentence = this.speechBuffer.slice(0, boundary + 1).trim()
      this.speechBuffer = this.speechBuffer.slice(boundary + 1)
      if (sentence) sentences.push(sentence)
    }
  }

  private synthesize(text: string, options = this.currentProsody): Promise<void> {
    const synthesis = this.synthesisTail
      .then(() => this.performSynthesis(text, options))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        this.warn(`TTS synthesis failed; continuing with text output: ${message}`)
      })
    this.synthesisTail = synthesis
    return synthesis
  }

  private async performSynthesis(text: string, options?: SynthesizeOptions): Promise<void> {
    for await (const chunk of this.dependencies.tts.synthesize(text, options)) {
      this.dependencies.sendToClient({ type: 'audio.delta', data: chunk.data })
      this.emitReachedScreenReferences()
    }
    this.emitReachedScreenReferences()
  }

  private emitReachedScreenReferences(): void {
    const playbackPosition = this.dependencies.tts.getPlaybackPosition()
    const reached = this.pendingScreenReferences.filter(({ at }) => at <= playbackPosition)
    this.pendingScreenReferences = this.pendingScreenReferences.filter(
      ({ at }) => at > playbackPosition
    )
    for (const reference of reached) {
      this.dependencies.sendToClient({
        type: 'screen.highlight',
        target: reference.target,
        mode: reference.type,
      })
    }
  }

  private warn(message: string): void {
    if (this.dependencies.warn) this.dependencies.warn(message)
    else logWarning(`[output-router] ${message}`)
  }

  private containsDetailedStructure(content: string): boolean {
    const hasCodeFence = /```/.test(content)
    const hasMarkdownTable = /^\s*\|.+\|\s*$/m.test(content) && /^\s*\|?\s*:?-{3,}/m.test(content)
    return hasCodeFence || hasMarkdownTable
  }

  private async flushReadyBatches(): Promise<void> {
    while (this.sentenceQueue.length >= this.sentenceBatchSize) {
      const batch = this.sentenceQueue.splice(0, this.sentenceBatchSize).join(' ')
      await this.synthesize(batch)
    }
  }
}

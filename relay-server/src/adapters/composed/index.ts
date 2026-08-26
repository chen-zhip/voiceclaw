import { randomUUID } from 'node:crypto'
import type { ProviderAdapter, SendToClient } from '../types.js'
import type { HarnessAdapter } from '../../harness-adapter/interface.js'
import type { StreamHandle, UserMessage } from '../../harness-adapter/types.js'
import type { STTProvider } from '../../stt/interface.js'
import type { TTSProvider } from '../../tts/interface.js'
import type { SessionConfigEvent } from '../../types.js'
import type { OutputRouter } from './output-router.js'

export class ComposedAdapter implements ProviderAdapter {
  readonly capabilities = { blockingToolResponse: false }
  private sendToClient: SendToClient = () => {}
  private readonly audioBuffer: string[] = []
  private retryAudio = false
  private sttTimeout: ReturnType<typeof setTimeout> | null = null
  private activeStream: StreamHandle | null = null
  private lastHarnessMessage: UserMessage | null = null
  private sessionId = ''
  private activeTurnId: string | null = null

  constructor(
    private readonly stt: STTProvider,
    private readonly harness: HarnessAdapter,
    private readonly tts: TTSProvider,
    private readonly outputRouter: OutputRouter
  ) {}

  async connect(config: SessionConfigEvent, sendToClient: SendToClient): Promise<void> {
    this.sendToClient = sendToClient
    this.sessionId = config.sessionKey ?? randomUUID()
    this.stt.onPartialTranscript((text) => {
      this.sendToClient({
        type: 'transcript.delta',
        text,
        role: 'user',
        source: 'speech',
      })
    })
    this.stt.onFinalTranscript((text) => {
      this.clearSTTTimeout()
      this.audioBuffer.length = 0
      this.retryAudio = false
      this.sendToClient({ type: 'transcript.done', text, role: 'user' })
      void this.sendMessage({ text })
    })
    this.stt.onError((message) => {
      this.sendToClient({ type: 'error', code: 502, message: `STT failed: ${message}` })
    })
    await Promise.all([
      this.stt.connect(config.sttConfig ?? {}),
      this.connectHarness(config),
      this.tts.connect(config.ttsConfig ?? {}),
    ])
  }

  sendAudio(data: string): void {
    this.startTurn()
    this.audioBuffer.push(data)
    this.stt.processAudio(data)
  }

  commitAudio(): void {
    this.clearSTTTimeout()
    if (this.retryAudio) {
      for (const data of this.audioBuffer) this.stt.processAudio(data)
      this.retryAudio = false
    }
    this.stt.commit()
    this.sttTimeout = setTimeout(() => {
      this.sttTimeout = null
      this.retryAudio = true
      this.sendToClient({
        type: 'error',
        code: 504,
        message: 'STT timed out after 10 seconds; retry the buffered audio',
      })
    }, 10_000)
  }

  sendFrame(_data: string, _mimeType?: string): void {}

  createResponse(): void {}

  cancelResponse(): void {
    this.activeStream?.cancel()
    this.activeStream = null
    if (!this.harness.capabilities.interruption && this.lastHarnessMessage) {
      void this.sendMessage(this.lastHarnessMessage)
    }
  }

  sendToolResult(_callId: string, _output: string): void {}

  injectContext(_text: string): void {}

  getTranscript(): { role: 'user' | 'assistant'; text: string }[] {
    return []
  }

  disconnect(): void {
    this.clearSTTTimeout()
    void this.stt.disconnect()
    void this.harness.disconnect()
    void this.tts.disconnect()
  }

  private clearSTTTimeout(): void {
    if (!this.sttTimeout) return
    clearTimeout(this.sttTimeout)
    this.sttTimeout = null
  }

  private async connectHarness(config: SessionConfigEvent): Promise<void> {
    try {
      await this.harness.connect({
        ...config.harnessConfig,
        ...(config.sessionKey ? { sessionId: config.sessionKey } : {}),
        ...(config.instructionsOverride ? { instructions: config.instructionsOverride } : {}),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.sendToClient({
        type: 'error',
        code: 503,
        message: `Harness unavailable: ${message}. Try S2S mode`,
      })
    }
  }

  private async sendMessage(message: UserMessage): Promise<void> {
    this.lastHarnessMessage = message
    const turnId = this.activeTurnId ?? this.startTurn()
    try {
      const stream = await this.harness.sendMessage(message, async (chunk) => {
        await this.outputRouter.route(chunk, {
          sessionId: this.sessionId,
          turnId,
          userQuery: message.text,
        })
        if (chunk.type === 'complete') this.activeTurnId = null
      })
      this.activeStream = stream
      void stream.done.catch((error: unknown) => this.handleHarnessStreamFailure(stream, error))
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      this.sendToClient({
        type: 'error',
        code: 502,
        message: `Harness request failed: ${detail}. Try S2S mode`,
      })
    }
  }

  private handleHarnessStreamFailure(stream: StreamHandle, error: unknown): void {
    if (this.activeStream !== stream) return
    this.activeStream = null
    this.activeTurnId = null
    const detail = error instanceof Error ? error.message : String(error)
    this.sendToClient({
      type: 'error',
      code: 502,
      message: `Harness request failed: ${detail}. Try S2S mode`,
    })
    this.sendToClient({ type: 'turn.ended' })
  }

  private startTurn(): string {
    if (this.activeTurnId) return this.activeTurnId
    this.activeTurnId = randomUUID()
    this.sendToClient({ type: 'turn.started', turnId: this.activeTurnId })
    return this.activeTurnId
  }
}

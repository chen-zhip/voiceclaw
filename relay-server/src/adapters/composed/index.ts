import { randomUUID } from 'node:crypto'
import type { ProviderAdapter, SendToClient } from '../types.js'
import type { HarnessAdapter } from '../../harness-adapter/interface.js'
import type { StreamHandle, UserMessage } from '../../harness-adapter/types.js'
import type { STTConfig, STTProvider } from '../../stt/interface.js'
import type { TTSConfig, TTSProvider } from '../../tts/interface.js'
import type { SessionConfigEvent } from '../../types.js'
import type { OutputRouter } from './output-router.js'
import type { HarnessRoutingPort } from '../../harness-execution/dispatch.js'
import { HarnessAttemptSession } from '../../harness-execution/session-routing.js'
import type { SttTtsDebugRecorder } from '../../stt-tts-debug.js'

const HARNESS_RECOVERY_GUIDANCE =
  'Resubmit the input after restoring the Harness configuration, or explicitly select S2S Direct with mode "s2s" and voiceMode "direct", or S2S Operator with mode "s2s" and voiceMode "operator".'

// Streaming recognizers answer in well under this budget; providers that need
// more (a local ASR CLI that loads models per utterance) declare their own.
const DEFAULT_STT_DEADLINE_MS = 10_000

interface ComposedAdapterDiagnostics {
  recorder: SttTtsDebugRecorder
  sttProviderId: string
  harnessProviderId: string
  ttsProviderId: string
}

export class ComposedAdapter implements ProviderAdapter {
  readonly capabilities = { blockingToolResponse: false }
  private sendToClient: SendToClient = () => {}
  private readonly audioBuffer: string[] = []
  private retryAudio = false
  private sttTimeout: ReturnType<typeof setTimeout> | null = null
  private activeStream: StreamHandle | null = null
  private sessionId = ''
  private activeTurnId: string | null = null
  private harnessSession: HarnessAttemptSession | null = null
  private inputBytes = 0
  private recognitionStartedAt: number | null = null
  private endpointReason: 'client-commit' | 'provider-finalized' | null = null
  private recognitionSampleRate: number | undefined
  private harnessBinding: SessionConfigEvent['harnessBinding'] | undefined

  constructor(
    private readonly stt: STTProvider,
    private readonly harness: HarnessAdapter,
    private readonly tts: TTSProvider,
    private readonly outputRouter: OutputRouter,
    private readonly harnessRouting?: HarnessRoutingPort,
    private readonly diagnostics?: ComposedAdapterDiagnostics
  ) {}

  async connect(config: SessionConfigEvent, sendToClient: SendToClient): Promise<void> {
    this.sendToClient = sendToClient
    this.sessionId = config.sessionKey ?? randomUUID()
    this.harnessBinding = config.harnessBinding
    const sttConfig = recognitionConfig(config)
    this.recognitionSampleRate = sttConfig.sampleRate
    this.harnessSession =
      this.harnessRouting && config.harnessBinding
        ? new HarnessAttemptSession({
            routing: this.harnessRouting,
            tts: this.tts,
            ...(config.ttsConfig?.sentenceBatchSize === undefined
              ? {}
              : { sentenceBatchSize: config.ttsConfig.sentenceBatchSize }),
            sendToClient: (event) => {
              this.sendToClient(event as never)
              if (event.type === 'harness.terminal') this.activeTurnId = null
            },
            ...(this.diagnostics?.recorder ? { debugRecorder: this.diagnostics.recorder } : {}),
            ...(this.diagnostics?.ttsProviderId
              ? { ttsProviderId: this.diagnostics.ttsProviderId }
              : {}),
            // The adapter is constructed only after the Relay Session is
            // authenticated, so the owning session is the cancel principal.
            cancelPrincipal: { kind: 'user', id: this.sessionId },
          })
        : null
    this.stt.onPartialTranscript((text) => {
      this.sendToClient({
        type: 'transcript.delta',
        text,
        role: 'user',
        source: 'speech',
      })
    })
    this.stt.onFinalTranscript((text) => {
      this.recordRecognition(text)
      this.clearSTTTimeout()
      this.audioBuffer.length = 0
      this.retryAudio = false
      this.resetRecognitionDiagnostics()
      this.dispatchText(text)
    })
    this.stt.onError((message) => {
      this.diagnostics?.recorder.record('stt.recognition.failed', {
        ...this.sttFields(),
        durationMs: this.recognitionDurationMs(),
        error: message,
      })
      this.sendToClient({ type: 'error', code: 502, message: `STT failed: ${message}` })
    })
    const connections = [] as Array<Promise<void>>
    if (config.inputMode !== 'text') {
      connections.push(
        this.connectComponent('stt', this.diagnostics?.sttProviderId, () =>
          this.stt.connect(sttConfig)
        )
      )
    }
    connections.push(
      this.connectHarness(config),
      this.connectComponent('tts', this.diagnostics?.ttsProviderId, () =>
        this.tts.connect(synthesisConfig(config))
      )
    )
    await Promise.all(connections)
  }

  sendAudio(data: string): void {
    this.startTurn()
    if (this.recognitionStartedAt === null) this.recognitionStartedAt = Date.now()
    this.inputBytes += Buffer.from(data, 'base64').length
    this.audioBuffer.push(data)
    this.stt.processAudio(data)
  }

  commitAudio(): void {
    this.clearSTTTimeout()
    if (this.recognitionStartedAt === null) this.recognitionStartedAt = Date.now()
    this.endpointReason = 'client-commit'
    this.recordAudioBoundary()
    if (this.retryAudio) {
      for (const data of this.audioBuffer) this.stt.processAudio(data)
      this.retryAudio = false
    }
    this.stt.commit()
    const deadlineMs = this.stt.finalTranscriptDeadlineMs ?? DEFAULT_STT_DEADLINE_MS
    this.sttTimeout = setTimeout(() => {
      this.sttTimeout = null
      this.retryAudio = true
      this.diagnostics?.recorder.record('stt.recognition.timeout', {
        ...this.sttFields(),
        endpointReason: this.endpointReason ?? 'client-commit',
        durationMs: this.recognitionDurationMs(),
      })
      this.sendToClient({
        type: 'error',
        code: 504,
        message: `STT timed out after ${Math.round(deadlineMs / 1000)} seconds; retry the buffered audio`,
      })
    }, deadlineMs)
  }

  sendFrame(_data: string, _mimeType?: string): void {}

  createResponse(): void {}

  cancelResponse(): void {
    this.recordSttCancellation('user requested cancellation')
    if (this.harnessSession) {
      void this.harnessSession.cancel('user requested cancellation')
      return
    }
    const hadActiveStream = this.activeStream !== null
    this.activeStream?.cancel()
    this.activeStream = null
    if (hadActiveStream && !this.harness.capabilities.interruption) {
      this.sendToClient({
        type: 'error',
        code: 409,
        message: `Harness interruption is unavailable. ${HARNESS_RECOVERY_GUIDANCE}`,
      })
    }
  }

  sendToolResult(_callId: string, _output: string): void {}

  injectContext(text: string): void {
    if (!text.trim()) return
    this.dispatchText(text)
  }

  getTranscript(): { role: 'user' | 'assistant'; text: string }[] {
    return []
  }

  disconnect(): void {
    this.recordSttCancellation('session disconnected')
    this.diagnostics?.recorder.record('session.disconnect', {
      sessionId: this.sessionId,
      stage: 'session',
      ...(this.activeTurnId === null ? {} : { turnId: this.activeTurnId }),
    })
    this.clearSTTTimeout()
    this.harnessSession = null
    this.harnessBinding = undefined
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
    const providerId = this.diagnostics?.harnessProviderId
    this.recordConnection('session.connect.start', 'harness', providerId)
    try {
      await this.harness.connect({
        ...config.harnessConfig,
        ...(config.sessionKey ? { sessionId: config.sessionKey } : {}),
        ...(config.instructionsOverride ? { instructions: config.instructionsOverride } : {}),
      })
      this.recordConnection('session.connect.complete', 'harness', providerId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.recordConnection('session.connect.failed', 'harness', providerId, message)
      this.sendToClient({
        type: 'error',
        code: 503,
        message: `Harness unavailable: ${message}. ${HARNESS_RECOVERY_GUIDANCE}`,
      })
    }
  }

  private sttFields() {
    return {
      sessionId: this.sessionId,
      stage: 'stt' as const,
      providerId: this.diagnostics?.sttProviderId,
      ...(this.activeTurnId === null ? {} : { turnId: this.activeTurnId }),
      inputBytes: this.inputBytes,
      ...(this.recognitionSampleRate === undefined
        ? {}
        : { sampleRate: this.recognitionSampleRate }),
    }
  }

  private recordAudioBoundary(): void {
    this.diagnostics?.recorder.record('stt.audio.commit', {
      ...this.sttFields(),
      endpointReason: this.endpointReason ?? 'provider-finalized',
    })
  }

  private recordSttCancellation(reason: string): void {
    if (this.recognitionStartedAt === null && this.inputBytes === 0) return
    this.diagnostics?.recorder.record('stt.recognition.cancelled', {
      ...this.sttFields(),
      durationMs: this.recognitionDurationMs(),
      reason,
    })
  }

  private recognitionDurationMs(): number {
    return Math.max(0, Date.now() - (this.recognitionStartedAt ?? Date.now()))
  }

  private resetRecognitionDiagnostics(): void {
    this.inputBytes = 0
    this.recognitionStartedAt = null
    this.endpointReason = null
  }

  private async connectComponent(
    componentRole: 'stt' | 'tts',
    providerId: string | undefined,
    connect: () => Promise<void>
  ): Promise<void> {
    this.recordConnection('session.connect.start', componentRole, providerId)
    try {
      await connect()
      this.recordConnection('session.connect.complete', componentRole, providerId)
    } catch (error) {
      this.recordConnection(
        'session.connect.failed',
        componentRole,
        providerId,
        error instanceof Error ? error.message : String(error)
      )
      throw error
    }
  }

  private recordConnection(
    event: 'session.connect.start' | 'session.connect.complete' | 'session.connect.failed',
    componentRole: 'stt' | 'harness' | 'tts',
    providerId: string | undefined,
    error?: string
  ): void {
    this.diagnostics?.recorder.record(event, {
      sessionId: this.sessionId,
      stage: 'session',
      componentRole,
      ...(providerId === undefined ? {} : { providerId }),
      ...(error === undefined ? {} : { error }),
    })
  }

  private async sendMessage(message: UserMessage): Promise<void> {
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
        message: `Harness request failed: ${detail}. ${HARNESS_RECOVERY_GUIDANCE}`,
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
      message: `Harness request failed: ${detail}. ${HARNESS_RECOVERY_GUIDANCE}`,
    })
    this.sendToClient({ type: 'turn.ended' })
  }

  private startTurn(): string {
    if (this.activeTurnId) return this.activeTurnId
    this.activeTurnId = randomUUID()
    this.sendToClient({ type: 'turn.started', turnId: this.activeTurnId })
    return this.activeTurnId
  }

  private dispatchText(text: string): void {
    this.startTurn()
    this.sendToClient({ type: 'transcript.done', text, role: 'user' })
    const binding = this.harnessBinding
    if (this.harnessSession && binding) {
      void this.harnessSession
        .accept(this.sessionId, text, {
          bindingId: binding.bindingId,
          providerId: binding.providerId,
          workspaceBindingId: binding.workspaceBindingId,
          generation: binding.generation ?? 0,
        })
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error)
          this.sendToClient({
            type: 'error',
            code: 502,
            message: `Harness request failed: ${detail}. ${HARNESS_RECOVERY_GUIDANCE}`,
          })
        })
      return
    }
    void this.sendMessage({ text })
  }

  private recordRecognition(text: string): void {
    if (!this.endpointReason) {
      this.endpointReason = 'provider-finalized'
      this.recordAudioBoundary()
    }
    this.diagnostics?.recorder.record('stt.recognition.complete', {
      ...this.sttFields(),
      endpointReason: this.endpointReason,
      durationMs: this.recognitionDurationMs(),
      transcriptText: text,
      transcriptCharacters: text.length,
    })
  }
}

// The client's PCM rate is a property of the pipeline, not of a provider, so
// every recognition provider learns it here; an explicit provider setting
// still wins.
function recognitionConfig(config: SessionConfigEvent): STTConfig {
  return {
    ...(typeof config.audioSampleRate === 'number' ? { sampleRate: config.audioSampleRate } : {}),
    ...(config.sttConfig ?? {}),
  }
}

// The client plays `audio.delta` PCM in the same context it captured with, so a
// provider that returns its own default rate would sound slowed down.
function synthesisConfig(config: SessionConfigEvent): TTSConfig {
  return {
    ...(typeof config.audioSampleRate === 'number' ? { sampleRate: config.audioSampleRate } : {}),
    ...(config.ttsConfig ?? {}),
  }
}

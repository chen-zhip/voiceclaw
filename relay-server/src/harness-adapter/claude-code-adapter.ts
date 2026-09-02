import type { HarnessAdapter, HarnessCapabilities, HarnessConfig } from './interface.js'
import type {
  ChunkHandler,
  InterruptionContext,
  OverlayContext,
  OverlayResponse,
  StreamHandle,
  UserMessage,
} from './types.js'
import { emitStructuredOutputStream } from './structured-output.js'

export interface HarnessTransportMessage {
  role: 'system' | 'user'
  content: string
}

export interface HarnessTransportRequest {
  config: HarnessConfig
  messages: HarnessTransportMessage[]
  signal: AbortSignal
}

export interface HarnessTransport {
  stream(request: HarnessTransportRequest): AsyncIterable<string>
  overlay?(request: HarnessTransportRequest): Promise<string>
}

export class ClaudeCodeAdapter implements HarnessAdapter {
  readonly id = 'claude-code'
  readonly capabilities: HarnessCapabilities = {
    structuredOutput: true,
    interruption: true,
    overlay: true,
    streaming: true,
  }

  private config: HarnessConfig | null = null
  private active = new Set<AbortController>()
  private activeDone = new Set<Promise<void>>()
  private streamHandlers = new WeakMap<StreamHandle, ChunkHandler>()

  constructor(private readonly transport: HarnessTransport) {}

  async connect(config: HarnessConfig): Promise<void> {
    this.config = config
  }

  async sendMessage(msg: UserMessage, onChunk: ChunkHandler): Promise<StreamHandle> {
    const config = this.requireConfig()
    const controller = new AbortController()
    this.active.add(controller)
    const done = emitStructuredOutputStream(
      this.transport.stream({
        config,
        messages: this.messages(msg.text),
        signal: controller.signal,
      }),
      onChunk
    )
      .catch((err: unknown) => {
        if (!controller.signal.aborted) throw err
      })
      .finally(() => {
        this.active.delete(controller)
        this.activeDone.delete(done)
      })
    this.activeDone.add(done)
    const handle: StreamHandle = {
      cancel: () => controller.abort(new Error('Harness stream cancelled')),
      done,
    }
    this.streamHandlers.set(handle, onChunk)
    return handle
  }

  async interrupt(handle: StreamHandle, ctx: InterruptionContext): Promise<StreamHandle> {
    const onChunk = this.streamHandlers.get(handle)
    if (!onChunk) throw new Error('Cannot interrupt a stream not created by this adapter')
    handle.cancel()
    return this.sendMessage({ text: `${ctx.spokenSoFar}\n${ctx.interruptionText}` }, onChunk)
  }

  async overlayQuery(query: string, ctx: OverlayContext): Promise<OverlayResponse> {
    const config = this.requireConfig()
    const signal = ctx.signal ?? new AbortController().signal
    const request = {
      config,
      messages: this.messages(query),
      signal,
    }
    const content = this.transport.overlay
      ? await this.transport.overlay(request)
      : await collectStream(this.transport.stream(request))
    return { content }
  }

  async disconnect(): Promise<void> {
    for (const controller of this.active) controller.abort(new Error('Harness disconnected'))
    await Promise.allSettled(this.activeDone)
    this.active.clear()
    this.activeDone.clear()
    this.config = null
  }

  private messages(text: string): HarnessTransportMessage[] {
    const instructions = this.config?.instructions?.trim()
    return [
      {
        role: 'system',
        content: instructions
          ? `${STRUCTURED_OUTPUT_CONTRACT}\n\n${instructions}`
          : STRUCTURED_OUTPUT_CONTRACT,
      },
      { role: 'user', content: text },
    ]
  }

  private requireConfig(): HarnessConfig {
    if (!this.config) throw new Error('Claude Code adapter used before connect')
    return this.config
  }
}

const STRUCTURED_OUTPUT_CONTRACT = [
  'Return JSON with a required speech object and optional thinking and text objects.',
  'thinking has steps and reasoning; speech has optional emotion, speed, and screenReferences followed by required content; text has content and format.',
  'Within speech, emit emotion, speed, and screenReferences before content, and emit content last so streaming synthesis receives metadata before audio starts.',
].join(' ')

async function collectStream(stream: AsyncIterable<string>): Promise<string> {
  let content = ''
  for await (const chunk of stream) content += chunk
  return content
}

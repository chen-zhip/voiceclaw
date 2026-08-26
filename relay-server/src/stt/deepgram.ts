// Deepgram does server-side VAD and endpointing, so this provider forwards raw
// PCM16 and lets `is_final`/`speech_final` in the response drive the partial vs
// final split. Audio that arrives before the socket is open is buffered rather
// than dropped — the client starts streaming as soon as it sees session.ready.

import WebSocket from 'ws'
import type { IncomingMessage } from 'node:http'
import { log, error as logError } from '../log.js'
import type { STTConfig, STTProvider, TranscriptCallback } from './interface.js'

export class DeepgramSTTProvider implements STTProvider {
  private upstream: WebSocket | null = null
  private config: STTConfig | null = null
  private pendingAudio: string[] = []
  private partialCallback: TranscriptCallback | null = null
  private finalCallback: TranscriptCallback | null = null
  private errorCallback: ((message: string) => void) | null = null
  private closing = false

  // Deepgram splits one utterance across several is_final segments; they are
  // joined here so the Harness receives a whole sentence rather than fragments.
  private finalSegments: string[] = []

  constructor(private readonly wsUrlOverride?: string) {}

  async connect(config: STTConfig): Promise<void> {
    this.config = config
    const apiKey = config.apiKey ?? process.env.DEEPGRAM_API_KEY
    if (!apiKey) {
      throw Object.assign(new Error('DEEPGRAM_API_KEY not set'), {
        userMessage:
          'Deepgram API key missing. Set DEEPGRAM_API_KEY on the relay or send sttConfig.apiKey in session.config.',
        actionUrl: 'https://console.deepgram.com/',
        actionLabel: 'Get a Deepgram API key',
      })
    }

    const url = new URL(this.wsUrlOverride ?? DEEPGRAM_WS_URL)
    for (const [key, value] of new URLSearchParams(this.buildQuery(config))) {
      url.searchParams.set(key, value)
    }
    const ws = new WebSocket(url, { headers: { Authorization: `Token ${apiKey}` } })
    this.upstream = ws

    await this.openSocket(ws, config)
  }

  processAudio(pcmData: string): void {
    if (!this.upstream || this.upstream.readyState !== WebSocket.OPEN) {
      if (this.pendingAudio.length < MAX_PENDING_CHUNKS) this.pendingAudio.push(pcmData)
      return
    }
    this.upstream.send(Buffer.from(pcmData, 'base64'))
  }

  commit(): void {
    if (this.upstream?.readyState !== WebSocket.OPEN) return
    // Deepgram's documented flush: an empty binary frame ends the utterance
    // without closing the stream.
    this.upstream.send(Buffer.alloc(0))
  }

  onPartialTranscript(callback: TranscriptCallback): void {
    this.partialCallback = callback
  }

  onFinalTranscript(callback: TranscriptCallback): void {
    this.finalCallback = callback
  }

  onError(callback: (message: string) => void): void {
    this.errorCallback = callback
  }

  async disconnect(): Promise<void> {
    this.closing = true
    this.pendingAudio = []
    this.finalSegments = []
    const ws = this.upstream
    this.upstream = null
    if (!ws || ws.readyState === WebSocket.CLOSED) return
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }))
    } catch {
      // Socket already going away — close() below is enough.
    }
    ws.close()
  }

  private async openSocket(ws: WebSocket, config: STTConfig): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (err?: Error) => {
        if (settled) return
        settled = true
        ws.removeListener('open', onOpen)
        ws.removeListener('unexpected-response', onUnexpectedResponse)
        if (err) reject(err)
        else resolve()
      }
      const onOpen = () => {
        log(`[deepgram] connected (model=${config.model ?? DEFAULT_MODEL})`)
        finish()
        this.flushPending()
      }
      const onUnexpectedResponse = (_req: unknown, res: IncomingMessage) => {
        const status = res.statusCode ?? null
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8').slice(0, 500)
          logError(`[deepgram] upgrade failed: HTTP ${status} ${body}`)
          finish(
            Object.assign(new Error(`Deepgram WebSocket upgrade failed: ${status}`), {
              httpStatus: status,
              bodyExcerpt: body || null,
              userMessage:
                status === 401
                  ? 'Deepgram rejected the API key. Check DEEPGRAM_API_KEY.'
                  : `Deepgram connection failed (HTTP ${status}).`,
            })
          )
        })
      }

      ws.on('open', onOpen)
      ws.on('unexpected-response', onUnexpectedResponse)
      ws.on('message', (raw: WebSocket.RawData) => this.handleMessage(raw))
      ws.on('error', (err: Error) => {
        logError('[deepgram] socket error:', err.message)
        finish(
          Object.assign(new Error(`Deepgram connection failed: ${err.message}`, { cause: err }), {
            userMessage:
              'Could not reach Deepgram. Check the relay network connection and try again.',
          })
        )
        this.errorCallback?.(`Deepgram connection error: ${err.message}`)
      })
      ws.on('close', (code: number) => {
        if (!this.closing) logError(`[deepgram] socket closed unexpectedly: ${code}`)
        finish(new Error(`Deepgram socket closed before ready: ${code}`))
      })
    })
  }

  private buildQuery(config: STTConfig): string {
    const params = new URLSearchParams({
      model: config.model ?? DEFAULT_MODEL,
      language: config.language ?? DEFAULT_LANGUAGE,
      encoding: 'linear16',
      sample_rate: String(config.sampleRate ?? DEFAULT_SAMPLE_RATE),
      channels: '1',
      interim_results: 'true',
      punctuate: 'true',
      vad_events: 'true',
      endpointing: String(config.endpointingMs ?? DEFAULT_ENDPOINTING_MS),
    })
    return params.toString()
  }

  private flushPending(): void {
    if (this.pendingAudio.length === 0) return
    log(`[deepgram] flushing ${this.pendingAudio.length} buffered audio chunk(s)`)
    const queued = this.pendingAudio
    this.pendingAudio = []
    for (const chunk of queued) this.processAudio(chunk)
  }

  private handleMessage(raw: WebSocket.RawData): void {
    let msg: DeepgramMessage
    try {
      msg = JSON.parse(String(raw)) as DeepgramMessage
    } catch (err) {
      logError('[deepgram] failed to parse message:', err)
      return
    }
    if (msg.type === 'Error') {
      const detail = msg.description ?? msg.message ?? 'unknown error'
      logError(`[deepgram] upstream error: ${detail}`)
      this.errorCallback?.(`Deepgram error: ${detail}`)
      return
    }
    if (msg.type === 'UtteranceEnd') {
      this.emitFinal()
      return
    }
    if (msg.type && msg.type !== 'Results') return

    const text = msg.channel?.alternatives?.[0]?.transcript?.trim()
    if (!text) {
      if (msg.speech_final) this.emitFinal()
      return
    }
    if (msg.is_final) {
      this.finalSegments.push(text)
      if (msg.speech_final) this.emitFinal()
      return
    }
    this.partialCallback?.(text)
  }

  private emitFinal(): void {
    if (this.finalSegments.length === 0) return
    const utterance = this.finalSegments.join(' ').replace(/\s+/g, ' ').trim()
    this.finalSegments = []
    if (utterance) this.finalCallback?.(utterance)
  }
}

const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen'
const DEFAULT_MODEL = 'nova-3'
const DEFAULT_LANGUAGE = 'en-US'
const DEFAULT_SAMPLE_RATE = 16000
const DEFAULT_ENDPOINTING_MS = 300
const MAX_PENDING_CHUNKS = 200

interface DeepgramAlternative {
  transcript?: string
}

interface DeepgramMessage {
  type?: string
  is_final?: boolean
  speech_final?: boolean
  channel?: { alternatives?: DeepgramAlternative[] }
  description?: string
  message?: string
}

export interface HarnessAudioTransport {
  send(message: Record<string, unknown>): void
  cancel(reason: string): Promise<void>
}

export interface HarnessAudioSnapshot {
  screenText: string[]
  audio: string[]
  playback: 'idle' | 'playing' | 'ended'
  terminal?: Record<string, unknown>
  recovery: string[]
}

export class STTTTSHarnessAudioBridge {
  #screenText: string[] = []
  #audio: string[] = []
  #playback: HarnessAudioSnapshot['playback'] = 'idle'
  #terminal: Record<string, unknown> | undefined
  #recovery: string[] = []

  constructor(private readonly transport: HarnessAudioTransport) {}

  appendMicrophone(data: string): void {
    this.transport.send({ type: 'audio.append', data })
  }

  commitMicrophone(): void {
    this.transport.send({ type: 'audio.commit' })
  }

  receive(event: Record<string, unknown>): void {
    if (event.type === 'harness.semantic-output' && typeof event.text === 'string') {
      this.#screenText.push(event.text)
      return
    }
    if (event.type === 'audio.delta' && typeof event.data === 'string') {
      this.#audio.push(event.data)
      this.#playback = 'playing'
      return
    }
    if (event.type === 'harness.terminal' && isRecord(event.outcome)) {
      this.#terminal = structuredClone(event.outcome)
      return
    }
    if (event.type === 'harness.error' && Array.isArray(event.recovery)) {
      this.#recovery = event.recovery.filter((item): item is string => typeof item === 'string')
    }
  }

  async cancel(reason: string): Promise<void> {
    await this.transport.cancel(reason)
    this.#playback = 'ended'
  }

  snapshot(): HarnessAudioSnapshot {
    return {
      screenText: [...this.#screenText],
      audio: [...this.#audio],
      playback: this.#playback,
      ...(this.#terminal ? { terminal: structuredClone(this.#terminal) } : {}),
      recovery: [...this.#recovery],
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

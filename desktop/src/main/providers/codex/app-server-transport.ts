import { isNonemptyString, isRecord } from '@voiceclaw/contracts'

export type CodexTransportState = 'open' | 'drained'

export interface CodexInitializeResponse {
  codexHome: string
  platformFamily: string
  platformOs: string
  userAgent: string
}

export interface CodexNativeNotification {
  method: string
  params: Record<string, unknown>
}

export class CodexAppServerTransportError extends Error {
  constructor(
    readonly code: 'codex_protocol_error' | 'codex_transport_closed' | 'codex_transport_timeout',
    message: string,
    readonly method?: string
  ) {
    super(message)
    this.name = 'CodexAppServerTransportError'
  }
}

interface PendingRequest {
  method: string
  resolve(value: unknown): void
  reject(error: Error): void
}

const MALFORMED_INPUT_LIMIT = 5
const MAX_LINE_LENGTH = 1_048_576
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const INITIALIZE_RESPONSE_FIELDS: Array<keyof CodexInitializeResponse> = [
  'codexHome',
  'platformFamily',
  'platformOs',
  'userAgent',
]

export class CodexAppServerTransport {
  #state: CodexTransportState = 'open'
  #nextId = 1
  #buffer = ''
  #malformedCount = 0
  readonly #requestTimeoutMs: number
  readonly #pending = new Map<number, PendingRequest>()
  readonly #protocolErrorHandlers: Array<(error: CodexAppServerTransportError) => void> = []
  readonly #notificationHandlers: Array<(notification: CodexNativeNotification) => void> = []

  constructor(
    private readonly boundary: {
      write(data: string): void
      requestTimeoutMs?: number
      validator?: {
        request(method: string, value: unknown): boolean
        response(method: string, value: unknown): boolean
        notification(method: string, value: unknown): boolean
      }
    }
  ) {
    this.#requestTimeoutMs = boundary.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  }

  get state(): CodexTransportState {
    return this.#state
  }

  onProtocolError(handler: (error: CodexAppServerTransportError) => void): void {
    this.#protocolErrorHandlers.push(handler)
  }

  onNotification(handler: (notification: CodexNativeNotification) => void): void {
    this.#notificationHandlers.push(handler)
  }

  initialize(client: { name: string; version: string }): Promise<CodexInitializeResponse> {
    return this.request('initialize', { clientInfo: { ...client } }).then((result) => {
      if (
        !isRecord(result) ||
        !INITIALIZE_RESPONSE_FIELDS.every((field) => isNonemptyString(result[field]))
      ) {
        throw new CodexAppServerTransportError(
          'codex_protocol_error',
          'Codex app-server returned an incompatible initialization response',
          'initialize'
        )
      }
      return {
        codexHome: result.codexHome as string,
        platformFamily: result.platformFamily as string,
        platformOs: result.platformOs as string,
        userAgent: result.userAgent as string,
      }
    })
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.boundary.validator && !this.boundary.validator.request(method, params)) {
      return Promise.reject(
        new CodexAppServerTransportError(
          'codex_protocol_error',
          'Codex request violates the pinned schema',
          method
        )
      )
    }
    if (this.#state !== 'open') {
      return Promise.reject(
        new CodexAppServerTransportError(
          'codex_transport_closed',
          'Codex app-server transport is not open',
          method
        )
      )
    }
    const id = this.#nextId
    this.#nextId += 1
    return new Promise((resolve, reject) => {
      const timer =
        this.#requestTimeoutMs > 0
          ? setTimeout(() => {
              if (!this.#pending.delete(id)) return
              reject(
                new CodexAppServerTransportError(
                  'codex_transport_timeout',
                  `Codex app-server did not answer ${method}`,
                  method
                )
              )
            }, this.#requestTimeoutMs)
          : undefined
      const settle = (run: () => void) => {
        if (timer !== undefined) clearTimeout(timer)
        run()
      }
      this.#pending.set(id, {
        method,
        resolve: (value) => settle(() => resolve(value)),
        reject: (error) => settle(() => reject(error)),
      })
      this.boundary.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  notify(method: string, params: Record<string, unknown>): void {
    if (this.#state !== 'open') return
    this.boundary.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  receive(chunk: string): void {
    if (this.#state !== 'open') return
    this.#buffer += chunk
    if (this.#buffer.length > MAX_LINE_LENGTH) {
      this.#buffer = ''
      this.#malformedInput()
      return
    }
    let separator = this.#buffer.indexOf('\n')
    while (separator >= 0) {
      const raw = this.#buffer.slice(0, separator)
      this.#buffer = this.#buffer.slice(separator + 1)
      const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      if (text.trim().length > 0) this.#message(text)
      if (this.#state !== 'open') return
      separator = this.#buffer.indexOf('\n')
    }
  }

  drain(
    code: 'codex_protocol_error' | 'codex_transport_closed' = 'codex_transport_closed',
    detail?: string
  ): void {
    if (this.#state !== 'open') return
    this.#state = 'drained'
    const pending = [...this.#pending.values()]
    this.#pending.clear()
    for (const request of pending) {
      request.reject(
        new CodexAppServerTransportError(
          code,
          detail
            ? `Codex app-server transport drained: ${detail}`
            : 'Codex app-server transport drained',
          request.method
        )
      )
    }
  }

  #message(text: string): void {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      this.#malformedInput()
      return
    }
    if (!isRecord(value)) {
      this.#malformedInput()
      return
    }
    if (typeof value.id !== 'number') {
      if (isNonemptyString(value.method) && isRecord(value.params)) {
        if (
          this.boundary.validator &&
          !this.boundary.validator.notification(value.method, value.params)
        ) {
          this.#schemaFailure(value.method)
          return
        }
        const notification: CodexNativeNotification = { method: value.method, params: value.params }
        for (const handler of this.#notificationHandlers) handler(structuredClone(notification))
      }
      return
    }
    const request = this.#pending.get(value.id)
    if (!request) return
    this.#pending.delete(value.id)
    if (isRecord(value.error)) {
      request.reject(
        new CodexAppServerTransportError(
          'codex_protocol_error',
          'Codex app-server rejected the request',
          request.method
        )
      )
      return
    }
    if (
      this.boundary.validator &&
      !this.boundary.validator.response(request.method, value.result)
    ) {
      request.reject(
        new CodexAppServerTransportError(
          'codex_protocol_error',
          'Codex response violates the pinned schema',
          request.method
        )
      )
      this.#schemaFailure(request.method)
      return
    }
    request.resolve(value.result)
  }

  #schemaFailure(method: string): void {
    this.drain('codex_protocol_error')
    const error = new CodexAppServerTransportError(
      'codex_protocol_error',
      'Codex message violates the pinned schema',
      method
    )
    for (const handler of this.#protocolErrorHandlers) handler(error)
  }

  #malformedInput(): void {
    this.#malformedCount += 1
    const error = new CodexAppServerTransportError(
      'codex_protocol_error',
      'Codex app-server emitted malformed transport input'
    )
    for (const handler of this.#protocolErrorHandlers) handler(error)
    if (this.#malformedCount > MALFORMED_INPUT_LIMIT) this.drain('codex_protocol_error')
  }
}

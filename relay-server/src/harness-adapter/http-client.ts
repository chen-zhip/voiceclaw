import type { HarnessTransport, HarnessTransportRequest } from './claude-code-adapter.js'
import { context, propagation } from '@opentelemetry/api'

export class HarnessHTTPClient implements HarnessTransport {
  constructor(private readonly fetchImpl: FetchLike = globalThis.fetch) {}

  async *stream(request: HarnessTransportRequest): AsyncIterable<string> {
    const baseUrl = request.config.gatewayUrl?.replace(/\/$/, '')
    if (!baseUrl) throw new Error('Harness gatewayUrl is required')
    const traceHeaders: Record<string, string> = {}
    propagation.inject(context.active(), traceHeaders)
    const controller = new AbortController()
    const onExternalAbort = () => controller.abort(request.signal.reason)
    if (request.signal.aborted) onExternalAbort()
    else request.signal.addEventListener('abort', onExternalAbort, { once: true })
    const timeoutMs = request.config.timeoutMs ?? 120_000
    const timeout = setTimeout(
      () => controller.abort(new Error(`Harness query timed out after ${timeoutMs} ms`)),
      timeoutMs
    )
    try {
      const response = await this.fetchImpl(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(request.config.authToken
            ? { Authorization: `Bearer ${request.config.authToken}` }
            : {}),
          ...traceHeaders,
        },
        body: JSON.stringify({ model: 'claude-code', messages: request.messages, stream: true }),
        signal: controller.signal,
      })
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Harness credentials rejected (${response.status}); configure HarnessConfig.authToken`
        )
      }
      if (!response.ok) {
        throw new Error(
          `Harness request failed with HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`
        )
      }
      yield* readResponse(response)
    } catch (err) {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason
        throw reason instanceof Error
          ? reason
          : new Error(String(reason ?? 'Harness request aborted'))
      }
      if (err instanceof Error && err.message.startsWith('Harness ')) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(
        `Claude Code Harness unreachable: ${message}. Run: claude --mode voice-plugin`
      )
    } finally {
      clearTimeout(timeout)
      request.signal.removeEventListener('abort', onExternalAbort)
    }
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

async function* readResponse(response: Response): AsyncIterable<string> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    yield await response.text()
    return
  }
  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        const parsed: unknown = JSON.parse(data)
        if (isRecord(parsed)) {
          const choices = parsed.choices
          if (Array.isArray(choices) && isRecord(choices[0]) && isRecord(choices[0].delta)) {
            const content = choices[0].delta.content
            if (typeof content === 'string') yield content
          } else {
            yield JSON.stringify(parsed)
          }
        } else if (typeof parsed === 'string') {
          yield parsed
        }
      } catch {
        yield data
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

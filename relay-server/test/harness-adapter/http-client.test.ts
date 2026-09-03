import { beforeAll, describe, expect, it, vi } from 'vitest'
import { context, propagation, trace } from '@opentelemetry/api'
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import type { HarnessTransportRequest } from '../../src/harness-adapter/claude-code-adapter.js'
import { HarnessHTTPClient } from '../../src/harness-adapter/http-client.js'

describe('HarnessHTTPClient', () => {
  beforeAll(() => {
    trace.setGlobalTracerProvider(new BasicTracerProvider())
    propagation.setGlobalPropagator(new W3CTraceContextPropagator())
    context.setGlobalContextManager(new AsyncHooksContextManager().enable())
  })

  it('does not recommend unsupported provider startup commands', async () => {
    const client = new HarnessHTTPClient(
      vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'))
    )

    await expect(collect(client.stream(request()))).rejects.toThrow(
      /^Harness gateway http:\/\/127\.0\.0\.1:9 unavailable: connect ECONNREFUSED$/
    )
  })

  it('maps actionable errors', async () => {
    const refused = new HarnessHTTPClient(
      vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'))
    )
    await expect(collect(refused.stream(request()))).rejects.toThrow(
      /Harness gateway http:\/\/127\.0\.0\.1:9 unavailable/
    )

    for (const status of [401, 403]) {
      const unauthorized = new HarnessHTTPClient(
        vi.fn().mockResolvedValue(new Response('denied', { status }))
      )
      await expect(collect(unauthorized.stream(request()))).rejects.toThrow(
        /credentials.*authToken/i
      )
    }
  })

  it('propagates trace context', async () => {
    let headers: HeadersInit | undefined
    const client = new HarnessHTTPClient(
      vi.fn(async (_input, init) => {
        headers = init?.headers
        return new Response('plain', { status: 200 })
      })
    )
    const span = trace.getTracer('harness-test').startSpan('parent')
    const spanContext = span.spanContext()

    await context.with(trace.setSpan(context.active(), span), () =>
      collect(client.stream(request()))
    )
    span.end()

    const traceparent = new Headers(headers).get('traceparent')
    expect(traceparent).toContain(spanContext.traceId)
    expect(traceparent).toContain(spanContext.spanId)
  })

  it('times out queries', async () => {
    vi.useFakeTimers()
    const external = new AbortController()
    let fetchSignal: AbortSignal | null = null
    const client = new HarnessHTTPClient(
      vi.fn((_input, init) => {
        fetchSignal = init?.signal as AbortSignal
        return new Promise((_resolve, reject) => {
          fetchSignal?.addEventListener('abort', () => reject(fetchSignal?.reason), { once: true })
        })
      })
    )
    const pending = collect(client.stream({ ...request(), signal: external.signal }))
    const rejection = expect(pending).rejects.toThrow(/timed out.*120000 ms/i)
    try {
      await vi.advanceTimersByTimeAsync(120_000)
      expect((fetchSignal as AbortSignal | null)?.aborted).toBe(true)
      await rejection
    } finally {
      external.abort()
      vi.useRealTimers()
    }
  })
})

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let content = ''
  for await (const chunk of stream) content += chunk
  return content
}

function request(): HarnessTransportRequest {
  return {
    config: { gatewayUrl: 'http://127.0.0.1:9', authToken: 'secret' },
    messages: [{ role: 'user', content: 'hello' }],
    signal: new AbortController().signal,
  }
}

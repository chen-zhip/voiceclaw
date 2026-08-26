import { describe, expect, it, vi } from 'vitest'
import {
  ClaudeCodeAdapter,
  type HarnessTransport,
  type HarnessTransportRequest,
} from '../../src/harness-adapter/claude-code-adapter.js'
import { HarnessHTTPClient } from '../../src/harness-adapter/http-client.js'

describe('ClaudeCodeAdapter', () => {
  it('injects structured output into every request', async () => {
    const requests: HarnessTransportRequest[] = []
    const transport: HarnessTransport = {
      stream(request) {
        requests.push(request)
        return streamChunks('plain response')
      },
    }
    const adapter = new ClaudeCodeAdapter(transport)
    await adapter.connect({ gatewayUrl: 'http://harness.test', authToken: 'token' })

    const handle = await adapter.sendMessage({ text: 'find bugs' }, () => {})
    await handle.done

    expect(requests).toHaveLength(1)
    expect(requests[0].messages).toEqual([
      expect.objectContaining({ role: 'system', content: expect.stringContaining('thinking') }),
      { role: 'user', content: 'find bugs' },
    ])
    expect(requests[0].messages[0].content).toContain('speech')
    expect(requests[0].messages[0].content).toContain('text')
    expect(requests[0].messages[0].content).toContain('before content')
  })

  it('emits structured chunks', async () => {
    const transport: HarnessTransport = {
      stream() {
        return streamChunks(
          JSON.stringify({
            thinking: { steps: ['inspect'], reasoning: 'Found it' },
            speech: { content: 'I found it.' },
            text: { content: '## Result', format: 'markdown' },
          })
        )
      },
    }
    const adapter = new ClaudeCodeAdapter(transport)
    await adapter.connect({ gatewayUrl: 'http://harness.test' })
    const chunks: unknown[] = []

    const handle = await adapter.sendMessage({ text: 'inspect' }, (chunk) => {
      chunks.push(chunk)
    })
    await handle.done

    expect(chunks).toEqual([
      {
        type: 'thinking.delta',
        content: JSON.stringify({ steps: ['inspect'], reasoning: 'Found it' }),
      },
      { type: 'speech.delta', content: 'I found it.' },
      { type: 'text.delta', content: '## Result', format: 'markdown' },
      {
        type: 'complete',
        output: {
          thinking: { steps: ['inspect'], reasoning: 'Found it' },
          speech: { content: 'I found it.' },
          text: { content: '## Result', format: 'markdown' },
        },
      },
    ])
  })

  it.each([
    ['plain response', 'plain response', 'plain response'],
    [JSON.stringify({ text: { content: 'details' } }), 'details', 'details'],
    [JSON.stringify({ speech: { content: 42 } }), '42', '42'],
  ])('degrades noncompliant output', async (raw, expectedSpeech, expectedText) => {
    const adapter = new ClaudeCodeAdapter({
      stream() {
        return streamChunks(raw)
      },
    })
    await adapter.connect({ gatewayUrl: 'http://harness.test' })
    const chunks: Array<{ type: string; content?: string }> = []

    const handle = await adapter.sendMessage({ text: 'inspect' }, (chunk) => {
      chunks.push(chunk)
    })
    await handle.done

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'speech.delta', content: expectedSpeech }),
        expect.objectContaining({ type: 'text.delta', content: expectedText }),
        expect.objectContaining({ type: 'complete' }),
      ])
    )
  })

  it('cancels active streams', async () => {
    const transport: HarnessTransport = {
      stream(request) {
        return waitForAbort(request.signal)
      },
    }
    const adapter = new ClaudeCodeAdapter(transport)
    await adapter.connect({ gatewayUrl: 'http://harness.test' })
    const chunks: unknown[] = []
    const handle = await adapter.sendMessage({ text: 'long task' }, (chunk) => chunks.push(chunk))

    await adapter.disconnect()

    await expect(handle.done).resolves.toBeUndefined()
    expect(chunks).toEqual([])
  })

  it('preserves output after interruption', async () => {
    let call = 0
    const transport: HarnessTransport = {
      stream(request) {
        call += 1
        if (call === 1) return waitForAbort(request.signal)
        return streamChunks(JSON.stringify({ speech: { content: 'Resumed.' } }))
      },
    }
    const adapter = new ClaudeCodeAdapter(transport)
    await adapter.connect({ gatewayUrl: 'http://harness.test' })
    const chunks: unknown[] = []
    const original = await adapter.sendMessage({ text: 'start' }, (chunk) => chunks.push(chunk))

    const resumed = await adapter.interrupt(original, {
      spokenSoFar: 'Partial',
      interruptionText: 'continue differently',
    })
    await resumed.done

    expect(chunks).toContainEqual({ type: 'speech.delta', content: 'Resumed.' })
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'complete' }))
  })

  it('emits incremental transport frames', async () => {
    let responseController: ReadableStreamDefaultController<Uint8Array> | undefined
    const transport = new HarnessHTTPClient(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              responseController = controller
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        )
    )
    const adapter = new ClaudeCodeAdapter(transport)
    await adapter.connect({ gatewayUrl: 'http://harness.test' })
    const chunks: unknown[] = []
    const handle = await adapter.sendMessage({ text: 'inspect' }, (chunk) => chunks.push(chunk))
    const output = JSON.stringify({ speech: { content: 'Early.' } })
    const frame = JSON.stringify({ choices: [{ delta: { content: output } }] })

    responseController?.enqueue(new TextEncoder().encode(`data: ${frame}\n\n`))
    try {
      await vi.waitFor(
        () => {
          expect(chunks).toContainEqual({ type: 'speech.delta', content: 'Early.' })
        },
        { timeout: 500 }
      )
    } finally {
      responseController?.close()
      await handle.done
    }
  })

  it('streams speech before the structured JSON completes', async () => {
    let releaseRemainder: (() => void) | undefined
    const transport: HarnessTransport = {
      async *stream() {
        yield '{"speech":{"content":"Early sentence."},'
        await new Promise<void>((resolve) => {
          releaseRemainder = resolve
        })
        yield '"text":{"content":"Later details","format":"plain"}}'
      },
    }
    const adapter = new ClaudeCodeAdapter(transport)
    await adapter.connect({ gatewayUrl: 'http://harness.test' })
    const chunks: unknown[] = []
    const handle = await adapter.sendMessage({ text: 'inspect' }, (chunk) => chunks.push(chunk))

    await vi.waitFor(() =>
      expect(chunks).toContainEqual({ type: 'speech.delta', content: 'Early sentence.' })
    )
    expect(chunks).not.toContainEqual(expect.objectContaining({ type: 'complete' }))

    releaseRemainder?.()
    await handle.done
    expect(
      chunks.filter((chunk) => (chunk as { type?: string }).type === 'speech.delta')
    ).toHaveLength(1)
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'complete' }))
  })

  it('never extracts nested thinking as early speech', async () => {
    let releaseSpeech: (() => void) | undefined
    const transport: HarnessTransport = {
      async *stream() {
        yield '{"thinking":{"speech":{"content":"private reasoning"}},'
        await new Promise<void>((resolve) => {
          releaseSpeech = resolve
        })
        yield '"speech":{"content":"Public answer."}}'
      },
    }
    const adapter = new ClaudeCodeAdapter(transport)
    await adapter.connect({ gatewayUrl: 'http://harness.test' })
    const chunks: unknown[] = []
    const handle = await adapter.sendMessage({ text: 'inspect' }, (chunk) => chunks.push(chunk))

    await vi.waitFor(() => expect(releaseSpeech).toBeTypeOf('function'))
    expect(JSON.stringify(chunks)).not.toContain('private reasoning')

    releaseSpeech?.()
    await handle.done
    expect(chunks).toContainEqual({ type: 'speech.delta', content: 'Public answer.' })
    expect(
      JSON.stringify(chunks.filter((chunk) => (chunk as { type?: string }).type === 'speech.delta'))
    ).not.toContain('private reasoning')
  })

  it('streams sentence boundaries from an open speech string', async () => {
    let releaseRemainder: (() => void) | undefined
    const transport: HarnessTransport = {
      async *stream() {
        yield '{"speech":{"content":"First sentence.'
        await new Promise<void>((resolve) => {
          releaseRemainder = resolve
        })
        yield ' Second sentence."}}'
      },
    }
    const adapter = new ClaudeCodeAdapter(transport)
    await adapter.connect({ gatewayUrl: 'http://harness.test' })
    const chunks: unknown[] = []
    const handle = await adapter.sendMessage({ text: 'inspect' }, (chunk) => chunks.push(chunk))

    await vi.waitFor(() =>
      expect(chunks).toContainEqual({ type: 'speech.delta', content: 'First sentence.' })
    )

    releaseRemainder?.()
    await handle.done
    expect(chunks).toContainEqual({ type: 'speech.delta', content: ' Second sentence.' })
  })

  it('preserves structured metadata', async () => {
    const transport: HarnessTransport = {
      async *stream() {
        yield JSON.stringify({
          speech: {
            content: 'See the result.',
            screenReferences: [{ at: 4, type: 'look', target: 'result' }],
          },
          text: {
            content: 'const answer = 42',
            format: 'code',
            language: 'typescript',
            sections: [{ id: 'result', title: 'Result', content: '42' }],
          },
        })
      },
    }
    const adapter = new ClaudeCodeAdapter(transport)
    await adapter.connect({ gatewayUrl: 'http://harness.test' })
    const chunks: unknown[] = []

    const handle = await adapter.sendMessage({ text: 'inspect' }, (chunk) => chunks.push(chunk))
    await handle.done

    expect(chunks).toContainEqual({
      type: 'speech.delta',
      content: 'See the result.',
      screenReferences: [{ at: 4, type: 'look', target: 'result' }],
    })
    expect(chunks).toContainEqual({
      type: 'text.delta',
      content: 'const answer = 42',
      format: 'code',
      language: 'typescript',
      sections: [{ id: 'result', title: 'Result', content: '42' }],
    })
  })

  it('forwards metadata that arrives after streamed speech content', async () => {
    const transport: HarnessTransport = {
      async *stream() {
        yield '{"speech":{"content":"See the result."'
        yield ',"emotion":"calm","speed":0.9,"screenReferences":[{"at":4,"type":"look","target":"result"}]}}'
      },
    }
    const adapter = new ClaudeCodeAdapter(transport)
    await adapter.connect({ gatewayUrl: 'http://harness.test' })
    const chunks: unknown[] = []

    const handle = await adapter.sendMessage({ text: 'inspect' }, (chunk) => chunks.push(chunk))
    await handle.done

    expect(chunks).toContainEqual({
      type: 'speech.delta',
      content: '',
      emotion: 'calm',
      speed: 0.9,
      screenReferences: [{ at: -11, type: 'look', target: 'result' }],
    })
  })

  it('streams leading speech metadata with open content', async () => {
    const transport: HarnessTransport = {
      async *stream() {
        yield '{"speech":{"emotion":"calm","speed":0.9,"screenReferences":[{"at":4,"type":"look","target":"result"}],"content":"See it.'
        yield '"}}'
      },
    }
    const adapter = new ClaudeCodeAdapter(transport)
    await adapter.connect({ gatewayUrl: 'http://harness.test' })
    const chunks: unknown[] = []

    const handle = await adapter.sendMessage({ text: 'inspect' }, (chunk) => chunks.push(chunk))
    await handle.done

    expect(chunks).toContainEqual({
      type: 'speech.delta',
      content: 'See it.',
      emotion: 'calm',
      speed: 0.9,
      screenReferences: [{ at: 4, type: 'look', target: 'result' }],
    })
  })
})

async function* streamChunks(...values: string[]): AsyncIterable<string> {
  for (const value of values) yield value
}

async function* waitForAbort(signal: AbortSignal): AsyncIterable<string> {
  await new Promise<void>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

import { describe, expect, it, vi } from 'vitest'
import { parseHarnessExecutionStream, type HarnessExecutionEvent } from '@voiceclaw/contracts'

const correlation = {
  invocationId: 'invocation-1',
  bindingId: 'binding-1',
  threadId: 'relay-thread-1',
  turnId: 'turn-1',
  attemptId: 'attempt-1',
  generation: 3,
}

const nativeThreadId = 'native-thread-1'

async function createStream(options: { idleTimeoutMs?: number } = {}) {
  const { CodexTurnStream } = await import('./app-server-turn.js')
  const requests: Array<{ method: string; params: Record<string, unknown> }> = []
  const stream = new CodexTurnStream({
    request: vi.fn(async (method: string, params: Record<string, unknown>) => {
      requests.push({ method, params })
      return { turn: { id: 'turn-1', items: [], status: 'inProgress' } }
    }),
    ...options,
  })
  const events: HarnessExecutionEvent[] = []
  stream.onEvent((event) => events.push(event))
  return { stream, requests, events }
}

describe('Codex turn.start', () => {
  it('sends a strict speech and screen output schema accepted by app-server', async () => {
    const { stream, requests } = await createStream()

    await stream.start({ correlation, nativeThreadId, text: 'Hello there' })
    const schema = requests[0].params.outputSchema as {
      required: string[]
      properties: Record<string, { required: string[]; properties: Record<string, unknown> }>
    }
    expect(Object.keys(schema.properties)).toEqual(['speech', 'text'])
    expect(schema.required).toEqual(['speech', 'text'])
    for (const value of Object.values(schema.properties)) {
      expect(value.required).toEqual(Object.keys(value.properties))
    }
  })

  it('sends an output schema and validates the completed structured agent message', async () => {
    const { stream, requests, events } = await createStream()

    await stream.start({ correlation, nativeThreadId, text: 'Hello there' })
    expect(requests[0]).toMatchObject({
      method: 'turn/start',
      params: {
        outputSchema: expect.objectContaining({
          type: 'object',
          required: ['speech', 'text'],
          properties: expect.any(Object),
        }),
      },
    })

    const structured = JSON.stringify({
      speech: { content: 'Spoken answer.' },
      text: { content: 'Detailed answer.', format: 'plain' },
    })
    stream.dispatch({
      method: 'item/agentMessage/delta',
      params: {
        threadId: nativeThreadId,
        turnId: 'turn-1',
        itemId: 'item-1',
        delta: structured.slice(0, 20),
      },
    })
    expect(events).toEqual([])
    stream.dispatch({
      method: 'item/completed',
      params: {
        threadId: nativeThreadId,
        turnId: 'turn-1',
        item: { type: 'agentMessage', id: 'item-1', text: structured },
      },
    })
    stream.dispatch({
      method: 'turn/completed',
      params: {
        threadId: nativeThreadId,
        turn: { id: 'turn-1', items: [], status: 'completed' },
      },
    })

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'semantic-output',
        payload: { audience: 'public', channel: 'speech', text: 'Spoken answer.' },
      }),
      expect.objectContaining({
        kind: 'semantic-output',
        payload: { audience: 'public', channel: 'screen', text: 'Detailed answer.' },
      }),
      expect.objectContaining({ kind: 'terminal', payload: { outcome: 'completed' } }),
    ])
  })

  it('shows text-only structured output without exposing its JSON or synthesizing empty speech', async () => {
    const { stream, events } = await createStream()
    await stream.start({ correlation, nativeThreadId, text: 'Count' })
    stream.dispatch({
      method: 'item/completed',
      params: {
        threadId: nativeThreadId,
        turnId: 'turn-1',
        item: {
          type: 'agentMessage',
          id: 'item-1',
          text: JSON.stringify({ speech: { content: '' }, text: { content: '1\n2\n3' } }),
        },
      },
    })
    stream.dispatch({
      method: 'turn/completed',
      params: { threadId: nativeThreadId, turn: { id: 'turn-1', items: [], status: 'completed' } },
    })

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'semantic-output',
        payload: { audience: 'public', channel: 'screen', text: '1\n2\n3' },
      }),
      expect.objectContaining({ kind: 'terminal', payload: { outcome: 'completed' } }),
    ])
  })

  it('converts a completed native agent message when no delta was emitted', async () => {
    const { stream, events } = await createStream()

    await stream.start({ correlation, nativeThreadId, text: 'Hello there' })
    stream.dispatch({
      method: 'item/completed',
      params: {
        threadId: nativeThreadId,
        turnId: 'turn-1',
        item: { type: 'agentMessage', id: 'item-1', text: 'Completed Codex answer.' },
      },
    })
    stream.dispatch({
      method: 'turn/completed',
      params: {
        threadId: nativeThreadId,
        turn: { id: 'turn-1', items: [], status: 'completed' },
      },
    })

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'diagnostic',
        payload: { class: 'provider-execution', code: 'codex_output_schema_invalid-json' },
      }),
      expect.objectContaining({
        kind: 'semantic-output',
        payload: {
          audience: 'public',
          channel: 'speech',
          text: 'Completed Codex answer.',
        },
      }),
      expect.objectContaining({
        kind: 'semantic-output',
        payload: {
          audience: 'public',
          channel: 'screen',
          text: 'Completed Codex answer.',
        },
      }),
      expect.objectContaining({ kind: 'terminal', payload: { outcome: 'completed' } }),
    ])
  })

  it('parses a final agent message carried by turn completion and ignores a duplicate item', async () => {
    const { stream, events } = await createStream()
    const structured = JSON.stringify({ speech: { content: 'Final answer.' } })

    await stream.start({ correlation, nativeThreadId, text: 'Hello there' })
    stream.dispatch({
      method: 'item/completed',
      params: {
        threadId: nativeThreadId,
        turnId: 'turn-1',
        item: { type: 'agentMessage', id: 'item-1', text: structured },
      },
    })
    stream.dispatch({
      method: 'turn/completed',
      params: {
        threadId: nativeThreadId,
        turn: {
          id: 'turn-1',
          status: 'completed',
          items: [{ type: 'agentMessage', id: 'item-1', text: structured }],
        },
      },
    })

    expect(events.filter((event) => event.kind === 'semantic-output')).toHaveLength(2)
    expect(events.at(-1)).toMatchObject({ kind: 'terminal', payload: { outcome: 'completed' } })
  })

  it('parses a final agent message when turn completion is the only completion event', async () => {
    const { stream, events } = await createStream()
    const structured = JSON.stringify({ speech: { content: 'Turn answer.' } })

    await stream.start({ correlation, nativeThreadId, text: 'Hello there' })
    stream.dispatch({
      method: 'turn/completed',
      params: {
        threadId: nativeThreadId,
        turn: {
          id: 'turn-1',
          status: 'completed',
          items: [{ type: 'agentMessage', id: 'item-1', text: structured }],
        },
      },
    })

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'semantic-output',
        payload: { audience: 'public', channel: 'speech', text: 'Turn answer.' },
      }),
      expect.objectContaining({
        kind: 'semantic-output',
        payload: { audience: 'public', channel: 'screen', text: 'Turn answer.' },
      }),
      expect.objectContaining({ kind: 'terminal', payload: { outcome: 'completed' } }),
    ])
  })

  it('translates only public streamed output', async () => {
    const { stream, requests, events } = await createStream()
    const structured = JSON.stringify({
      speech: { content: 'Spoken answer.' },
      text: { content: 'Detailed answer.', format: 'plain' },
    })

    await stream.start({ correlation, nativeThreadId, text: 'Hello there' })
    expect(requests[0]).toMatchObject({
      method: 'turn/start',
      params: {
        threadId: 'native-thread-1',
        input: [{ type: 'text', text: 'Hello there' }],
        outputSchema: expect.any(Object),
      },
    })

    stream.dispatch({
      method: 'item/agentMessage/delta',
      params: {
        threadId: nativeThreadId,
        turnId: 'turn-1',
        itemId: 'item-1',
        delta: structured.slice(0, 20),
      },
    })
    stream.dispatch({
      method: 'item/agentMessage/delta',
      params: {
        threadId: nativeThreadId,
        turnId: 'turn-1',
        itemId: 'item-1',
        delta: structured.slice(20),
      },
    })
    stream.dispatch({
      method: 'item/agentMessage/delta',
      params: { threadId: nativeThreadId, turnId: 'other-turn', itemId: 'item-9', delta: 'stray' },
    })
    stream.dispatch({
      method: 'item/reasoning/textDelta',
      params: {
        threadId: nativeThreadId,
        turnId: 'turn-1',
        itemId: 'reasoning-1',
        delta: 'private chain of thought',
      },
    })
    stream.dispatch({
      method: 'item/completed',
      params: {
        threadId: nativeThreadId,
        turnId: 'turn-1',
        item: { type: 'agentMessage', id: 'item-1', text: structured },
      },
    })
    stream.dispatch({
      method: 'item/started',
      params: {
        threadId: nativeThreadId,
        turnId: 'turn-1',
        startedAtMs: 1,
        item: { type: 'reasoning', id: 'reasoning-1', content: ['private reasoning'] },
      },
    })
    stream.dispatch({
      method: 'item/started',
      params: {
        threadId: nativeThreadId,
        turnId: 'turn-1',
        startedAtMs: 2,
        item: { type: 'commandExecution', id: 'command-1', command: 'rm -rf C:\\private' },
      },
    })
    stream.dispatch({
      method: 'item/completed',
      params: {
        threadId: nativeThreadId,
        turnId: 'turn-1',
        completedAtMs: 3,
        item: {
          type: 'commandExecution',
          id: 'command-1',
          command: 'rm -rf C:\\private',
          aggregatedOutput: 'removed C:\\private',
        },
      },
    })
    stream.dispatch({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: nativeThreadId,
        turnId: 'turn-1',
        tokenUsage: {
          total: {
            inputTokens: 30,
            outputTokens: 12,
            totalTokens: 42,
            cachedInputTokens: 0,
            reasoningOutputTokens: 0,
          },
          last: {
            inputTokens: 30,
            outputTokens: 12,
            totalTokens: 42,
            cachedInputTokens: 0,
            reasoningOutputTokens: 0,
          },
        },
      },
    })
    stream.dispatch({
      method: 'turn/completed',
      params: {
        threadId: nativeThreadId,
        turn: { id: 'turn-1', items: [], status: 'completed' },
      },
    })

    expect(events).toEqual([
      expect.objectContaining({
        ...correlation,
        sequence: 1,
        kind: 'semantic-output',
        payload: { audience: 'public', channel: 'speech', text: 'Spoken answer.' },
      }),
      expect.objectContaining({
        ...correlation,
        sequence: 2,
        kind: 'semantic-output',
        payload: { audience: 'public', channel: 'screen', text: 'Detailed answer.' },
      }),
      expect.objectContaining({
        sequence: 3,
        kind: 'outcome-evidence',
        payload: { fact: 'command-execution', phase: 'started' },
      }),
      expect.objectContaining({
        sequence: 4,
        kind: 'outcome-evidence',
        payload: { fact: 'command-execution', phase: 'completed' },
      }),
      expect.objectContaining({
        sequence: 5,
        kind: 'outcome-evidence',
        payload: { fact: 'token-usage', inputTokens: 30, outputTokens: 12, totalTokens: 42 },
      }),
      expect.objectContaining({
        sequence: 6,
        kind: 'terminal',
        payload: { outcome: 'completed' },
      }),
    ])
    expect(parseHarnessExecutionStream(events).success).toBe(true)
    const serialized = JSON.stringify(events)
    expect(serialized).not.toMatch(/private chain of thought|rm -rf|aggregatedOutput/)
    expect(serialized).not.toMatch(/item\/|turn\/|thread\/tokenUsage/)
    await expect(stream.terminal).resolves.toMatchObject({
      kind: 'terminal',
      payload: { outcome: 'completed' },
    })
  })

  it('emits one terminal outcome and ignores later notifications', async () => {
    const { stream, events } = await createStream()
    await stream.start({ correlation, nativeThreadId, text: 'Hello there' })

    stream.dispatch({
      method: 'turn/completed',
      params: { threadId: nativeThreadId, turn: { id: 'turn-1', items: [], status: 'completed' } },
    })
    stream.dispatch({
      method: 'item/agentMessage/delta',
      params: { threadId: nativeThreadId, turnId: 'turn-1', itemId: 'item-1', delta: 'late' },
    })

    expect(events.map((event) => event.kind)).toEqual(['terminal'])
  })

  it('rejects a Turn stream that cannot be started', async () => {
    const { CodexTurnStream } = await import('./app-server-turn.js')
    const stream = new CodexTurnStream({
      request: async () => ({ turn: { items: [] } }),
    })

    await expect(
      stream.start({ correlation, nativeThreadId, text: 'Hello there' })
    ).rejects.toMatchObject({ code: 'codex_turn_start_failed' })
  })

  it('interrupts only the active Codex Turn', async () => {
    const { stream, requests, events } = await createStream()
    await stream.start({ correlation, nativeThreadId, text: 'Hello there' })

    await expect(
      stream.cancel({ correlation: { ...correlation, attemptId: 'attempt-2' } })
    ).rejects.toMatchObject({ code: 'codex_turn_cancel_failed' })
    await expect(
      stream.cancel({ correlation: { ...correlation, generation: 4 } })
    ).rejects.toMatchObject({ code: 'codex_turn_cancel_failed' })
    expect(requests.filter((request) => request.method === 'turn/interrupt')).toEqual([])

    await stream.cancel({ correlation })
    expect(requests[1]).toEqual({
      method: 'turn/interrupt',
      params: { threadId: nativeThreadId, turnId: 'turn-1' },
    })

    stream.dispatch({
      method: 'turn/completed',
      params: {
        threadId: nativeThreadId,
        turn: { id: 'turn-1', items: [], status: 'interrupted' },
      },
    })
    stream.dispatch({
      method: 'item/agentMessage/delta',
      params: { threadId: nativeThreadId, turnId: 'turn-1', itemId: 'item-1', delta: 'late' },
    })

    expect(events.filter((event) => event.kind === 'terminal')).toEqual([
      expect.objectContaining({ payload: { outcome: 'cancelled' } }),
    ])
    expect(JSON.stringify(events)).not.toMatch(/late/)
    await expect(stream.terminal).resolves.toMatchObject({ payload: { outcome: 'cancelled' } })
  })

  it('refuses to cancel a Turn that is not active', async () => {
    const { stream } = await createStream()

    await expect(stream.cancel({ correlation })).rejects.toMatchObject({
      code: 'codex_turn_cancel_failed',
    })
  })

  it('normalizes one terminal outcome', async () => {
    const completed = await createStream()
    await completed.stream.start({ correlation, nativeThreadId, text: 'Hello there' })
    completed.stream.dispatch({
      method: 'turn/completed',
      params: { threadId: nativeThreadId, turn: { id: 'turn-1', items: [], status: 'completed' } },
    })
    await expect(completed.stream.terminal).resolves.toMatchObject({
      payload: { outcome: 'completed' },
    })
    expect(completed.stream.failure).toBeNull()

    const cancelled = await createStream()
    await cancelled.stream.start({ correlation, nativeThreadId, text: 'Hello there' })
    cancelled.stream.dispatch({
      method: 'turn/completed',
      params: {
        threadId: nativeThreadId,
        turn: { id: 'turn-1', items: [], status: 'interrupted' },
      },
    })
    await expect(cancelled.stream.terminal).resolves.toMatchObject({
      payload: { outcome: 'cancelled' },
    })
    expect(cancelled.stream.failure).toEqual({
      class: 'cancellation',
      code: 'codex_turn_cancelled',
    })

    const failed = await createStream()
    await failed.stream.start({ correlation, nativeThreadId, text: 'Hello there' })
    failed.stream.dispatch({
      method: 'turn/completed',
      params: {
        threadId: nativeThreadId,
        turn: {
          id: 'turn-1',
          items: [],
          status: 'failed',
          error: {
            message: 'unexpected status 401 Unauthorized: C:\\private\\credentials',
            codexErrorInfo: 'unauthorized',
          },
        },
      },
    })
    await expect(failed.stream.terminal).resolves.toMatchObject({
      payload: { outcome: 'failed' },
    })
    expect(failed.stream.failure).toEqual({
      class: 'authorization',
      code: 'codex_authorization_unavailable',
    })
    expect(failed.events.map((event) => event.kind)).toEqual(['diagnostic', 'terminal'])
    expect(JSON.stringify(failed.events)).not.toMatch(/Unauthorized|credentials/)

    const unknown = await createStream()
    await unknown.stream.start({ correlation, nativeThreadId, text: 'Hello there' })
    unknown.stream.transportLost()
    await expect(unknown.stream.terminal).resolves.toMatchObject({
      payload: { outcome: 'unknown' },
    })
    expect(unknown.stream.failure).toEqual({
      class: 'transport',
      code: 'codex_transport_lost',
    })
  })

  it('classifies native failures into provider-neutral classes', async () => {
    const { classifyCodexFailure } = await import('./codex-failure.js')

    expect(classifyCodexFailure({ kind: 'json-rpc', method: 'initialize', code: -32602 })).toEqual({
      class: 'configuration',
      code: 'codex_configuration_invalid',
    })
    expect(classifyCodexFailure({ kind: 'json-rpc', method: 'turn/start', code: -32601 })).toEqual({
      class: 'protocol',
      code: 'codex_protocol_incompatible',
    })
    expect(classifyCodexFailure({ kind: 'transport-closed' })).toEqual({
      class: 'transport',
      code: 'codex_transport_lost',
    })
    expect(classifyCodexFailure({ kind: 'process-exit' })).toEqual({
      class: 'process',
      code: 'codex_process_failed',
    })
    expect(classifyCodexFailure({ kind: 'executable-missing' })).toEqual({
      class: 'executable',
      code: 'codex_executable_unavailable',
    })
    expect(classifyCodexFailure({ kind: 'workspace-denied' })).toEqual({
      class: 'workspace',
      code: 'codex_workspace_unavailable',
    })
    expect(classifyCodexFailure({ kind: 'interrupted' })).toEqual({
      class: 'cancellation',
      code: 'codex_turn_cancelled',
    })
    expect(
      classifyCodexFailure({
        kind: 'provider-error',
        codexErrorInfo: 'unauthorized',
      })
    ).toEqual({ class: 'authorization', code: 'codex_authorization_unavailable' })
    expect(
      classifyCodexFailure({
        kind: 'provider-error',
        codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: null } },
      })
    ).toEqual({ class: 'transport', code: 'codex_transport_lost' })
    expect(
      classifyCodexFailure({ kind: 'provider-error', codexErrorInfo: 'internalServerError' })
    ).toEqual({ class: 'provider-execution', code: 'codex_turn_failed' })
  })

  it('ignores stale, duplicate, and terminal-late signals', async () => {
    const { stream, events } = await createStream()
    await stream.start({ correlation, nativeThreadId, text: 'Hello there' })

    stream.dispatch({
      method: 'turn/completed',
      params: {
        threadId: nativeThreadId,
        turn: { id: 'stale-turn', items: [], status: 'failed' },
      },
    })
    expect(events.filter((event) => event.kind === 'terminal')).toEqual([])

    stream.dispatch({
      method: 'turn/completed',
      params: { threadId: nativeThreadId, turn: { id: 'turn-1', items: [], status: 'completed' } },
    })
    stream.dispatch({
      method: 'turn/completed',
      params: { threadId: nativeThreadId, turn: { id: 'turn-1', items: [], status: 'failed' } },
    })
    stream.dispatch({
      method: 'item/agentMessage/delta',
      params: { threadId: nativeThreadId, turnId: 'turn-1', itemId: 'item-1', delta: 'late' },
    })

    expect(events.filter((event) => event.kind === 'terminal')).toEqual([
      expect.objectContaining({ payload: { outcome: 'completed' } }),
    ])
    expect(stream.failure).toBeNull()
  })

  it('does not replay a Turn after post-dispatch transport loss', async () => {
    const { stream, requests, events } = await createStream()
    await stream.start({ correlation, nativeThreadId, text: 'Hello there' })

    stream.transportLost()
    stream.transportLost()

    expect(requests.map((request) => request.method)).toEqual(['turn/start'])
    expect(events.filter((event) => event.kind === 'terminal')).toEqual([
      expect.objectContaining({ payload: { outcome: 'unknown' } }),
    ])
  })

  it('terminates a Turn whose Provider stops making progress', async () => {
    const { stream, requests, events } = await createStream({ idleTimeoutMs: 20 })
    await stream.start({ correlation, nativeThreadId, text: 'Hello there' })

    stream.dispatch({
      method: 'error',
      params: {
        threadId: nativeThreadId,
        turnId: 'turn-1',
        willRetry: true,
        error: {
          message: 'Reconnecting... waiting for network',
          codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: null } },
        },
      },
    })
    await new Promise((done) => setTimeout(done, 60))

    expect(events.filter((event) => event.kind === 'terminal')).toEqual([
      expect.objectContaining({ payload: { outcome: 'unknown' } }),
    ])
    expect(stream.failure).toEqual({ class: 'transport', code: 'codex_turn_stalled' })
    expect(parseHarnessExecutionStream(events).success).toBe(true)

    // Releasing the binding must also stop the native Turn it no longer tracks.
    await new Promise((done) => setTimeout(done, 20))
    expect(requests.at(-1)).toEqual({
      method: 'turn/interrupt',
      params: { threadId: nativeThreadId, turnId: 'turn-1' },
    })
  })

  it('keeps a Turn alive while the Provider keeps producing output', async () => {
    const { stream, events } = await createStream({ idleTimeoutMs: 40 })
    await stream.start({ correlation, nativeThreadId, text: 'Hello there' })

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await new Promise((done) => setTimeout(done, 25))
      stream.dispatch({
        method: 'item/agentMessage/delta',
        params: { threadId: nativeThreadId, turnId: 'turn-1', itemId: 'item-1', delta: 'x' },
      })
    }
    await new Promise((done) => setTimeout(done, 20))

    expect(events.filter((event) => event.kind === 'terminal')).toEqual([])
    stream.dispatch({
      method: 'turn/completed',
      params: { threadId: nativeThreadId, turn: { id: 'turn-1', items: [], status: 'completed' } },
    })
    expect(events.filter((event) => event.kind === 'terminal')).toEqual([
      expect.objectContaining({ payload: { outcome: 'completed' } }),
    ])
  })
})

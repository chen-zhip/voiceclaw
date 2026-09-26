import { describe, expect, it } from 'vitest'

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

async function createTransport(options: { requestTimeoutMs?: number } = {}) {
  const { CodexAppServerTransport } = await import('./app-server-transport.js')
  const written: string[] = []
  const transport = new CodexAppServerTransport({
    write: (data) => written.push(data),
    ...options,
  })
  return { transport, written }
}

describe('Codex app-server stdio transport', () => {
  it('initializes a local app-server', async () => {
    const { transport, written } = await createTransport()

    const initialized = transport.initialize({ name: 'voiceclaw-desktop', version: '0.10.51' })
    expect(JSON.parse(written[0])).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'voiceclaw-desktop', version: '0.10.51' } },
    })

    transport.receive(
      line({
        jsonrpc: '2.0',
        id: 1,
        result: {
          codexHome: 'C:\\codex',
          platformFamily: 'windows',
          platformOs: 'windows',
          userAgent: 'codex-cli/0.153.4',
        },
      })
    )

    await expect(initialized).resolves.toEqual({
      codexHome: 'C:\\codex',
      platformFamily: 'windows',
      platformOs: 'windows',
      userAgent: 'codex-cli/0.153.4',
    })
  })

  it('rejects an initialization response that does not match the pinned schema', async () => {
    const { transport } = await createTransport()

    const initialized = transport.initialize({ name: 'voiceclaw-desktop', version: '0.10.51' })
    transport.receive(line({ jsonrpc: '2.0', id: 1, result: { codexHome: 'C:\\codex' } }))

    await expect(initialized).rejects.toMatchObject({ code: 'codex_protocol_error' })
  })

  it('correlates ordered JSON-RPC responses by request id', async () => {
    const { transport, written } = await createTransport()

    const start = transport.request('thread/start', { cwd: 'C:\\workspaces\\first' })
    const interrupt = transport.request('turn/interrupt', {
      threadId: 'thread-1',
      turnId: 'turn-1',
    })
    expect(written.map((entry) => JSON.parse(entry).id)).toEqual([1, 2])

    transport.receive(line({ jsonrpc: '2.0', id: 2, result: { turnId: 'turn-1' } }))
    transport.receive(line({ jsonrpc: '2.0', id: 1, result: { threadId: 'thread-1' } }))

    await expect(start).resolves.toEqual({ threadId: 'thread-1' })
    await expect(interrupt).resolves.toEqual({ turnId: 'turn-1' })
  })

  it('reassembles a message that spans transport chunks', async () => {
    const { transport } = await createTransport()

    const start = transport.request('thread/start', { cwd: 'C:\\workspaces\\first' })
    const message = line({ jsonrpc: '2.0', id: 1, result: { threadId: 'thread-1' } })
    transport.receive(message.slice(0, 12))
    transport.receive(message.slice(12))

    await expect(start).resolves.toEqual({ threadId: 'thread-1' })
  })

  it('bounds malformed input before draining the transport', async () => {
    const { transport } = await createTransport()
    const reported: unknown[] = []
    transport.onProtocolError((error) => reported.push(error))
    const start = transport.request('thread/start', { cwd: 'C:\\workspaces\\first' })

    for (let attempt = 0; attempt < 5; attempt += 1) transport.receive('{not json\n')
    expect(reported).toHaveLength(5)
    expect(transport.state).toBe('open')

    transport.receive('{not json\n')
    expect(transport.state).toBe('drained')
    await expect(start).rejects.toMatchObject({ code: 'codex_protocol_error' })
  })

  it('normalizes a protocol failure without leaking provider content', async () => {
    const { transport } = await createTransport()

    const start = transport.request('thread/start', { cwd: 'C:\\workspaces\\private-project' })
    transport.receive(
      line({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32602, message: 'Invalid params: C:\\workspaces\\private-project' },
      })
    )

    const failure = await start.catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'codex_protocol_error', method: 'thread/start' })
    expect(JSON.stringify(failure)).not.toMatch(/private-project|-32602/)
  })

  it('drains pending requests without replaying them', async () => {
    const { transport } = await createTransport()

    const start = transport.request('thread/start', { cwd: 'C:\\workspaces\\first' })
    transport.drain()
    transport.receive(line({ jsonrpc: '2.0', id: 1, result: { threadId: 'thread-1' } }))

    await expect(start).rejects.toMatchObject({ code: 'codex_transport_closed' })
    expect(transport.state).toBe('drained')
  })

  it('fails a request whose response never arrives', async () => {
    const { transport } = await createTransport({ requestTimeoutMs: 20 })

    const failure = transport
      .request('thread/start', { cwd: 'C:\\workspaces\\first' })
      .catch((error: unknown) => error)
    await new Promise((done) => setTimeout(done, 60))

    await expect(failure).resolves.toMatchObject({
      code: 'codex_transport_timeout',
      method: 'thread/start',
    })
  })
})

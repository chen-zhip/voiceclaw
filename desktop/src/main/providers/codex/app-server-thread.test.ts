import { describe, expect, it, vi } from 'vitest'

const mapping = {
  conversationId: 'conversation-1',
  providerId: 'codex',
  workspaceBindingId: 'workspace-1',
}

async function createRegistry(responses: Record<string, unknown>) {
  const { CodexThreadRegistry } = await import('./app-server-thread.js')
  const calls: Array<{ method: string; params: Record<string, unknown> }> = []
  let nextThread = 1
  const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params })
    if (method in responses) return structuredClone(responses[method])
    return { thread: { id: `thread-${nextThread++}`, cwd: params.cwd } }
  })
  return { registry: new CodexThreadRegistry({ request }), calls, request }
}

describe('Codex thread.ensure', () => {
  it('creates a Workspace-bound Thread for a new mapping', async () => {
    const { registry, calls } = await createRegistry({})

    const ensured = await registry.ensure({
      mapping,
      workspacePath: 'C:\\workspaces\\first',
    })

    expect(ensured).toEqual({ threadId: 'thread-1', resumed: false })
    expect(calls).toEqual([{ method: 'thread/start', params: { cwd: 'C:\\workspaces\\first' } }])
  })

  it('resumes the mapped Thread for a later Turn instead of selecting another Workspace', async () => {
    const { registry, calls } = await createRegistry({
      'thread/resume': { thread: { id: 'thread-1', cwd: 'C:\\workspaces\\first' } },
    })

    await registry.ensure({ mapping, workspacePath: 'C:\\workspaces\\first' })
    const resumed = await registry.ensure({
      mapping,
      workspacePath: 'C:\\workspaces\\first',
    })

    expect(resumed).toEqual({ threadId: 'thread-1', resumed: true })
    expect(calls).toEqual([
      { method: 'thread/start', params: { cwd: 'C:\\workspaces\\first' } },
      { method: 'thread/resume', params: { threadId: 'thread-1' } },
    ])
  })

  it('treats a different Conversation or Workspace as a distinct mapping', async () => {
    const { registry, calls } = await createRegistry({})
    const workspacePath = 'C:\\workspaces\\first'

    const first = await registry.ensure({ mapping, workspacePath })
    const otherConversation = await registry.ensure({
      mapping: { ...mapping, conversationId: 'conversation-2' },
      workspacePath,
    })
    const otherWorkspace = await registry.ensure({
      mapping: { ...mapping, workspaceBindingId: 'workspace-2' },
      workspacePath: 'C:\\workspaces\\second',
    })

    expect(
      new Set([first.threadId, otherConversation.threadId, otherWorkspace.threadId]).size
    ).toBe(3)
    expect(calls.map((call) => call.method)).toEqual([
      'thread/start',
      'thread/start',
      'thread/start',
    ])
    expect(calls[2].params).toEqual({ cwd: 'C:\\workspaces\\second' })
  })

  it('creates only one Thread for a mapping with concurrent Turns', async () => {
    const { registry, request } = await createRegistry({})

    const [first, second] = await Promise.all([
      registry.ensure({ mapping, workspacePath: 'C:\\workspaces\\first' }),
      registry.ensure({ mapping, workspacePath: 'C:\\workspaces\\first' }),
    ])

    expect(first).toEqual({ threadId: 'thread-1', resumed: false })
    expect(second.resumed).toBe(true)
    expect(second.threadId).toBe('thread-1')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('normalizes an unusable Thread response', async () => {
    const { registry } = await createRegistry({ 'thread/start': { thread: { cwd: 'C:\\ws' } } })

    await expect(
      registry.ensure({ mapping, workspacePath: 'C:\\workspaces\\first' })
    ).rejects.toMatchObject({ code: 'codex_thread_mapping_failed' })
  })
})

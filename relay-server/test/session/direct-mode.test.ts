// Wire-level integration test for the "direct to provider" capabilities
// exposed on the existing /ws route: `mint_token` and `tool.exec`. Both must
// work without a prior `session.config` so the mobile client can authenticate
// and delegate tools without ever spinning up a relay-side adapter.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RelaySession } from '../../src/session.js'
import { ensureWorkspace, getWorkspaceRoot } from '../../src/workspace.js'
import type { ClientEvent, RelayEvent } from '../../src/types.js'

const posixIt = process.platform === 'win32' ? it.skip : it

describe('session direct-mode messages', () => {
  let tmpRoot: string
  let prevWorkspace: string | undefined
  let prevGeminiKey: string | undefined
  let prevAllowUnauth: string | undefined

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'voiceclaw-direct-mode-'))
    prevWorkspace = process.env.VOICECLAW_WORKSPACE
    process.env.VOICECLAW_WORKSPACE = join(tmpRoot, 'workspace')
    await ensureWorkspace()
    prevGeminiKey = process.env.GEMINI_API_KEY
    // The existing tests assume no RELAY_API_KEY set, so set the explicit
    // dev-bypass; per-test cases override this to test the locked-down path.
    prevAllowUnauth = process.env.RELAY_ALLOW_UNAUTHENTICATED
    process.env.RELAY_ALLOW_UNAUTHENTICATED = 'true'
  })

  afterEach(async () => {
    if (prevWorkspace === undefined) delete process.env.VOICECLAW_WORKSPACE
    else process.env.VOICECLAW_WORKSPACE = prevWorkspace
    if (prevGeminiKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = prevGeminiKey
    if (prevAllowUnauth === undefined) delete process.env.RELAY_ALLOW_UNAUTHENTICATED
    else process.env.RELAY_ALLOW_UNAUTHENTICATED = prevAllowUnauth
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('tool.exec runs read and replies with a tool.result over the wire (no session.config required)', async () => {
    const path = join(getWorkspaceRoot(), 'notes.md')
    await writeFile(path, 'hello world\n', 'utf-8')

    const { session, sent } = mountSession()
    await deliver(session, {
      type: 'tool.exec',
      callId: 'call-1',
      name: 'read',
      arguments: JSON.stringify({ path: 'notes.md' }),
    })
    await waitForEvent(sent, (e) => e.type === 'tool.result')

    const result = sent.find((e) => e.type === 'tool.result')
    expect(result).toBeDefined()
    expect((result as Extract<RelayEvent, { type: 'tool.result' }>).callId).toBe('call-1')
    expect((result as Extract<RelayEvent, { type: 'tool.result' }>).name).toBe('read')
    const parsed = JSON.parse((result as Extract<RelayEvent, { type: 'tool.result' }>).result) as {
      content: string
    }
    expect(parsed.content).toBe('1\thello world\n')
  })

  it('tool.exec emits tool.error for unknown tool names', async () => {
    const { session, sent } = mountSession()
    await deliver(session, {
      type: 'tool.exec',
      callId: 'call-bogus',
      name: 'definitely-not-a-tool' as never,
      arguments: '{}',
    })
    await waitForEvent(sent, (e) => e.type === 'tool.error')
    const err = sent.find((e) => e.type === 'tool.error') as Extract<
      RelayEvent,
      { type: 'tool.error' }
    >
    expect(err.callId).toBe('call-bogus')
    expect(err.error).toMatch(/unknown tool/)
  })

  it('tool.exec bash respects the denylist and surfaces a tool.error', async () => {
    const { session, sent } = mountSession()
    await deliver(session, {
      type: 'tool.exec',
      callId: 'call-deny',
      name: 'bash',
      arguments: JSON.stringify({ command: 'sudo rm -rf /' }),
    })
    await waitForEvent(sent, (e) => e.type === 'tool.error')
    const err = sent.find((e) => e.type === 'tool.error') as Extract<
      RelayEvent,
      { type: 'tool.error' }
    >
    expect(err.error).toMatch(/safety policy/)
  })

  posixIt('tool.exec bash streams tool.progress events while it runs', async () => {
    const { session, sent } = mountSession()
    await deliver(session, {
      type: 'tool.exec',
      callId: 'call-stream',
      name: 'bash',
      arguments: JSON.stringify({ command: 'echo aaa; echo bbb' }),
    })
    await waitForEvent(sent, (e) => e.type === 'tool.result')
    const progress = sent.filter((e) => e.type === 'tool.progress')
    const joined = progress
      .map((p) => (p as Extract<RelayEvent, { type: 'tool.progress' }>).textDelta ?? '')
      .join('')
    expect(joined).toMatch(/aaa/)
    expect(joined).toMatch(/bbb/)
  })

  it('mint_token returns a token for provider=gemini (mocked)', async () => {
    process.env.GEMINI_API_KEY = 'stub-relay-key'
    const fetchImpl = async () =>
      new Response(JSON.stringify({ name: 'ephem-XYZ', expireTime: '2099-01-01T00:00:00Z' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    using _ = withFetch(fetchImpl as unknown as typeof fetch)

    const { session, sent } = mountSession()
    await deliver(session, {
      type: 'mint_token',
      provider: 'gemini',
      model: 'gemini-3.1-flash-live-preview',
    })
    await waitForEvent(sent, (e) => e.type === 'token' || e.type === 'token.error')
    const token = sent.find((e) => e.type === 'token') as
      | Extract<RelayEvent, { type: 'token' }>
      | undefined
    expect(token).toBeDefined()
    expect(token?.provider).toBe('gemini')
    expect(token?.token).toBe('ephem-XYZ')
    expect(token?.ephemeral).toBe(true)
  })

  it('mint_token rejects non-gemini providers with token.error', async () => {
    process.env.GEMINI_API_KEY = 'stub-relay-key'
    const { session, sent } = mountSession()
    await deliver(session, { type: 'mint_token', provider: 'openai' })
    await waitForEvent(sent, (e) => e.type === 'token.error')
    const err = sent.find((e) => e.type === 'token.error') as Extract<
      RelayEvent,
      { type: 'token.error' }
    >
    expect(err.provider).toBe('openai')
    expect(err.message).toMatch(/direct mode not yet supported/)
  })

  it('mint_token reports token.error when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY
    const { session, sent } = mountSession()
    await deliver(session, { type: 'mint_token', provider: 'gemini' })
    await waitForEvent(sent, (e) => e.type === 'token.error')
    const err = sent.find((e) => e.type === 'token.error') as Extract<
      RelayEvent,
      { type: 'token.error' }
    >
    expect(err.message).toMatch(/GEMINI_API_KEY/)
  })

  it('session.prep returns instructions + gemini tool declarations without a session.config', async () => {
    const { session, sent } = mountSession()
    await deliver(session, {
      type: 'session.prep',
      config: {
        type: 'session.config',
        provider: 'gemini',
        voice: 'Zephyr',
        model: 'gemini-3.1-flash-live-preview',
        brainAgent: 'enabled',
        apiKey: 'stub-key',
      },
    })
    await waitForEvent(
      sent,
      (e) => e.type === 'session.prep.result' || e.type === 'session.prep.error'
    )
    const result = sent.find((e) => e.type === 'session.prep.result') as
      | Extract<RelayEvent, { type: 'session.prep.result' }>
      | undefined
    expect(result).toBeDefined()
    expect(typeof result?.instructions).toBe('string')
    expect((result?.instructions ?? '').length).toBeGreaterThan(0)
    expect(Array.isArray(result?.tools)).toBe(true)
    // read/write/edit/bash are unconditionally registered by getRelayTools.
    const names = (result?.tools ?? []).map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['read', 'write', 'edit', 'bash']))
    for (const t of result?.tools ?? []) {
      expect(typeof t.name).toBe('string')
      expect(typeof t.description).toBe('string')
      expect(typeof t.parameters).toBe('object')
    }
  })

  it('session.prep advertises web_search when a Tavily key is available', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test'
    try {
      const { session, sent } = mountSession()
      await deliver(session, {
        type: 'session.prep',
        config: {
          type: 'session.config',
          provider: 'gemini',
          voice: 'Zephyr',
          model: 'gemini-3.1-flash-live-preview',
          brainAgent: 'enabled',
          apiKey: 'stub-key',
        },
      })
      await waitForEvent(sent, (e) => e.type === 'session.prep.result')
      const result = sent.find((e) => e.type === 'session.prep.result') as
        | Extract<RelayEvent, { type: 'session.prep.result' }>
        | undefined
      const names = (result?.tools ?? []).map((t) => t.name)
      expect(names).toContain('web_search')
      // echo_tool is a test-only tool the direct path can't fulfill — never advertised.
      expect(names).not.toContain('echo_tool')
    } finally {
      delete process.env.TAVILY_API_KEY
    }
  })

  it('session.prep omits web_search when no Tavily key is available', async () => {
    delete process.env.TAVILY_API_KEY
    const { session, sent } = mountSession()
    await deliver(session, {
      type: 'session.prep',
      config: {
        type: 'session.config',
        provider: 'gemini',
        voice: 'Zephyr',
        model: 'gemini-3.1-flash-live-preview',
        brainAgent: 'enabled',
        apiKey: 'stub-key',
      },
    })
    await waitForEvent(sent, (e) => e.type === 'session.prep.result')
    const result = sent.find((e) => e.type === 'session.prep.result') as
      | Extract<RelayEvent, { type: 'session.prep.result' }>
      | undefined
    const names = (result?.tools ?? []).map((t) => t.name)
    expect(names).not.toContain('web_search')
  })

  it('tool.exec runs web_search end-to-end after prep (mocked Tavily)', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test'
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          query: 'who won the game',
          answer: 'Team A.',
          results: [{ title: 't', url: 'https://e.com', content: 'c' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    using _ = withFetch(fetchImpl as unknown as typeof fetch)
    try {
      const { session, sent } = mountSession()
      // prep must run first: it resolves + stashes the Tavily key the
      // standalone tool.exec path uses (the direct path carries no session.config).
      await deliver(session, {
        type: 'session.prep',
        config: {
          type: 'session.config',
          provider: 'gemini',
          voice: 'Zephyr',
          model: 'gemini-3.1-flash-live-preview',
          brainAgent: 'enabled',
          apiKey: 'stub-key',
        },
      })
      await waitForEvent(sent, (e) => e.type === 'session.prep.result')

      await deliver(session, {
        type: 'tool.exec',
        callId: 'call-ws',
        name: 'web_search',
        arguments: JSON.stringify({ query: 'who won the game' }),
      })
      await waitForEvent(sent, (e) => e.type === 'tool.result' || e.type === 'tool.error')
      const result = sent.find((e) => e.type === 'tool.result') as
        | Extract<RelayEvent, { type: 'tool.result' }>
        | undefined
      expect(result).toBeDefined()
      expect(result?.callId).toBe('call-ws')
      expect(result?.name).toBe('web_search')
      const parsed = JSON.parse(result?.result ?? '{}') as { answer: string }
      expect(parsed.answer).toBe('Team A.')
    } finally {
      delete process.env.TAVILY_API_KEY
    }
  })

  describe('auth gating', () => {
    let prevRelayKey: string | undefined
    let prevAllow: string | undefined

    beforeEach(() => {
      prevRelayKey = process.env.RELAY_API_KEY
      prevAllow = process.env.RELAY_ALLOW_UNAUTHENTICATED
      process.env.RELAY_API_KEY = 'the-real-key'
      delete process.env.RELAY_ALLOW_UNAUTHENTICATED
    })

    afterEach(() => {
      if (prevRelayKey === undefined) delete process.env.RELAY_API_KEY
      else process.env.RELAY_API_KEY = prevRelayKey
      if (prevAllow === undefined) delete process.env.RELAY_ALLOW_UNAUTHENTICATED
      else process.env.RELAY_ALLOW_UNAUTHENTICATED = prevAllow
    })

    it('rejects tool.exec from an unauthenticated peer (1008 close)', async () => {
      const { session, sent, fakeWs } = mountSession()
      let closed = false
      fakeWs.close = () => {
        closed = true
      }
      await deliver(session, {
        type: 'tool.exec',
        callId: 'call-evil',
        name: 'bash',
        arguments: JSON.stringify({ command: 'echo pwned' }),
      })
      const err = sent.find((e) => e.type === 'error') as
        | Extract<RelayEvent, { type: 'error' }>
        | undefined
      expect(err).toBeDefined()
      expect(err?.code).toBe(401)
      expect(closed).toBe(true)
    })

    it('rejects mint_token from an unauthenticated peer', async () => {
      process.env.GEMINI_API_KEY = 'stub-relay-key'
      const { session, sent, fakeWs } = mountSession()
      let closed = false
      fakeWs.close = () => {
        closed = true
      }
      await deliver(session, { type: 'mint_token', provider: 'gemini' })
      const err = sent.find((e) => e.type === 'error') as
        | Extract<RelayEvent, { type: 'error' }>
        | undefined
      expect(err?.code).toBe(401)
      expect(closed).toBe(true)
      // The token must NEVER have been minted.
      expect(sent.some((e) => e.type === 'token')).toBe(false)
    })

    it('rejects session.prep from an unauthenticated peer', async () => {
      const { session, sent, fakeWs } = mountSession()
      let closed = false
      fakeWs.close = () => {
        closed = true
      }
      await deliver(session, {
        type: 'session.prep',
        config: {
          type: 'session.config',
          provider: 'gemini',
          voice: 'Zephyr',
          model: 'gemini-3.1-flash-live-preview',
          brainAgent: 'enabled',
          apiKey: 'stub-key',
        },
      })
      const err = sent.find((e) => e.type === 'error') as
        | Extract<RelayEvent, { type: 'error' }>
        | undefined
      expect(err?.code).toBe(401)
      expect(closed).toBe(true)
    })

    it('session.auth with wrong key returns 401 and closes', async () => {
      const { session, sent, fakeWs } = mountSession()
      let closed = false
      fakeWs.close = () => {
        closed = true
      }
      await deliver(session, { type: 'session.auth', apiKey: 'wrong' })
      const err = sent.find((e) => e.type === 'error') as
        | Extract<RelayEvent, { type: 'error' }>
        | undefined
      expect(err?.code).toBe(401)
      expect(closed).toBe(true)
    })

    it('session.auth with the right master key authenticates with NO device-token bridge env (self-connect regression)', async () => {
      // Exact desktop self-connect scenario: bundled RELAY_API_KEY, no
      // device-token bridge URL/nonce in env. Must succeed without ever
      // contacting the bridge, otherwise the desktop's own relay-client
      // and `yarn dev` lock themselves out.
      delete process.env.VOICECLAW_DEVICE_TOKEN_CHECK_URL
      delete process.env.VOICECLAW_DEVICE_TOKEN_CHECK_NONCE
      let fetchCalled = false
      const original = globalThis.fetch
      globalThis.fetch = (async () => {
        fetchCalled = true
        return new Response('fail', { status: 500 })
      }) as typeof fetch
      try {
        const { session, sent, fakeWs } = mountSession()
        let closed = false
        fakeWs.close = () => {
          closed = true
        }
        await deliver(session, { type: 'session.auth', apiKey: 'the-real-key' })
        const ok = sent.find((e) => e.type === 'session.auth.ok')
        expect(ok).toBeDefined()
        expect(closed).toBe(false)
        expect(fetchCalled).toBe(false)
      } finally {
        globalThis.fetch = original
      }
    })

    it('session.auth with the right key flips the gate and subsequent tool.exec works', async () => {
      process.env.GEMINI_API_KEY = 'stub-relay-key'
      const { session, sent } = mountSession()
      await deliver(session, { type: 'session.auth', apiKey: 'the-real-key' })
      const ok = sent.find((e) => e.type === 'session.auth.ok')
      expect(ok).toBeDefined()
      // Now mint_token should succeed (with a mocked auth_tokens upstream).
      const fetchImpl = async () =>
        new Response(JSON.stringify({ name: 'ephem-1', expireTime: '2099-01-01T00:00:00Z' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      using _ = withFetch(fetchImpl as unknown as typeof fetch)
      await deliver(session, { type: 'mint_token', provider: 'gemini' })
      await waitForEvent(sent, (e) => e.type === 'token' || e.type === 'token.error')
      const token = sent.find((e) => e.type === 'token') as
        | Extract<RelayEvent, { type: 'token' }>
        | undefined
      expect(token?.token).toBe('ephem-1')
    })
  })

  it('mint_token returns token.error (no raw-key fallback) when the upstream call fails', async () => {
    process.env.GEMINI_API_KEY = 'stub-relay-key'
    const fetchImpl = async () => new Response('forbidden', { status: 403 })
    using _ = withFetch(fetchImpl as unknown as typeof fetch)

    const { session, sent } = mountSession()
    await deliver(session, { type: 'mint_token', provider: 'gemini' })
    await waitForEvent(sent, (e) => e.type === 'token' || e.type === 'token.error')
    const token = sent.find((e) => e.type === 'token') as
      | Extract<RelayEvent, { type: 'token' }>
      | undefined
    const err = sent.find((e) => e.type === 'token.error') as
      | Extract<RelayEvent, { type: 'token.error' }>
      | undefined
    expect(token).toBeUndefined()
    expect(err).toBeDefined()
    expect(err?.message).toMatch(/403/)
    // The raw key must never leak in the failure payload.
    expect(err?.message).not.toContain('stub-relay-key')
  })
})

interface FakeWs {
  OPEN: number
  readyState: number
  send: (data: string) => void
  close: () => void
  on: (event: string, listener: (...args: unknown[]) => void) => void
}

interface MountedSession {
  session: RelaySession
  sent: RelayEvent[]
  fakeWs: FakeWs
}

function mountSession(): MountedSession {
  const sent: RelayEvent[] = []
  const fakeWs: FakeWs = {
    OPEN: 1,
    readyState: 1,
    send: (data: string) => sent.push(JSON.parse(data) as RelayEvent),
    close: () => {},
    on: () => {},
  }
  const session = new RelaySession(fakeWs as unknown as never)
  return { session, sent, fakeWs }
}

async function deliver(session: RelaySession, event: ClientEvent): Promise<void> {
  const inner = session as unknown as { handleMessage: (raw: unknown) => Promise<void> }
  await inner.handleMessage(JSON.stringify(event))
}

async function waitForEvent(
  sent: RelayEvent[],
  predicate: (e: RelayEvent) => boolean,
  timeoutMs = 3000
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (sent.some(predicate)) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(
    `timed out waiting for event after ${timeoutMs}ms; saw: ${sent.map((e) => e.type).join(',')}`
  )
}

// Tiny scoped fetch shim that restores the global on dispose. Uses the
// `using` declaration for guaranteed cleanup even on test failure.
function withFetch(fn: typeof fetch): Disposable {
  const original = globalThis.fetch
  globalThis.fetch = fn
  return {
    [Symbol.dispose]: () => {
      globalThis.fetch = original
    },
  }
}

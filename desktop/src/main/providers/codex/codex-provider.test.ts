import { describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { KernelInvocationEnvelope } from '@voiceclaw/contracts'
import {
  createCodexContribution,
  type CodexContributionBoundary,
  type CodexProcessChannel,
} from './codex-provider.js'

const configuration = {
  bindingId: 'binding-1',
  workspaceBindingId: 'workspace-1',
  workspacePath: 'C:\\workspace',
  executablePath: 'codex',
  preferences: {},
  secretRefs: {},
}

function envelope(operation: string, invocationId: string): KernelInvocationEnvelope {
  return {
    contract: { id: 'harness.execution', version: '1.0.0' },
    operation,
    invocationId,
    principal: { kind: 'contribution', id: 'routing' },
    scope: { kind: 'workspace', id: 'workspace-1' },
    selectedContribution: {
      packageId: 'voiceclaw-provider-codex',
      contributionId: 'codex-provider',
    },
    generation: 1,
    trace: { traceId: 'trace-diagnostics' },
    cancellation: { supported: true, token: 'cancel-diagnostics' },
  }
}

function createFakeAppServer() {
  const exitHandlers: Array<() => void> = []
  const diagnosticHandlers: Array<(chunk: string) => void> = []
  const channel: CodexProcessChannel = {
    write: () => undefined,
    onData: () => undefined,
    onDiagnostic: (handler) => {
      diagnosticHandlers.push(handler)
    },
    onExit: (handler) => {
      exitHandlers.push(handler)
    },
  }
  const boundary: CodexContributionBoundary = {
    detectExecutable: async () => true,
    detectVersion: async () => 'codex-cli 0.153.4',
    start: async () => ({ pid: 4242, channel }),
    terminate: async () => undefined,
  }
  return {
    boundary,
    emitDiagnostic: (chunk: string) => {
      for (const handler of diagnosticHandlers) handler(chunk)
    },
    emitExit: () => {
      for (const handler of exitHandlers) handler()
    },
  }
}

async function settleState(
  promise: Promise<unknown>
): Promise<'resolved' | 'rejected' | 'pending'> {
  return Promise.race([
    promise.then<'resolved' | 'rejected'>(
      () => 'resolved',
      () => 'rejected'
    ),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 50)),
  ])
}

describe('Codex Contribution session lifecycle', () => {
  it('fences invalid usage instead of publishing it as public evidence', async () => {
    const server = createResponsiveAppServer()
    const contribution = createCodexContribution({
      activeHostId: 'host-1',
      configuration,
      boundary: server.boundary,
    })
    const turn = contribution.invoke({
      envelope: envelope('turn.start', 'usage-1'),
      payload: { threadId: 'native-thread', input: { text: 'Hello' }, generation: 1 },
    })
    await vi.waitFor(() =>
      expect(server.requests.some((r) => r.method === 'turn/start')).toBe(true)
    )
    server.emit({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 'native-thread',
        turnId: 'native-turn',
        tokenUsage: { total: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } },
      },
    })
    const events = await turn
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'terminal', payload: { outcome: 'unknown' } }),
      ])
    )
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ payload: expect.objectContaining({ fact: 'token-usage' }) }),
      ])
    )
    await contribution.dispose()
  })
  it('rejects a native Turn response that violates the pinned schema', async () => {
    const server = createResponsiveAppServer({ invalidTurn: true })
    const contribution = createCodexContribution({
      activeHostId: 'host-1',
      configuration,
      boundary: server.boundary,
    })
    await expect(
      contribution.invoke({
        envelope: envelope('turn.start', 'invalid-turn'),
        payload: { threadId: 'native-thread', input: { text: 'Hello' }, generation: 1 },
      })
    ).rejects.toMatchObject({ code: 'codex_protocol_error' })
    await contribution.dispose()
  })
  it('refuses dispatch when the pinned schema artifact is missing', async () => {
    const server = createResponsiveAppServer()
    const directory = await mkdtemp(join(tmpdir(), 'codex-missing-schema-'))
    const contribution = createCodexContribution({
      activeHostId: 'host-1',
      configuration,
      boundary: server.boundary,
      schemaDirectory: directory,
    })
    await expect(
      contribution.invoke({
        envelope: envelope('thread.ensure', 'ensure-1'),
        payload: { conversationId: 'conversation-1', workspaceBindingId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'schema_artifact_missing' })
    expect(server.requests).toEqual([])
  })
  it('forwards the selected model to the native Turn', async () => {
    const server = createResponsiveAppServer()
    const contribution = createCodexContribution({
      activeHostId: 'host-1',
      configuration: { ...configuration, preferences: { model: 'gpt-6-luna' } },
      boundary: server.boundary,
    })
    const payload = {
      bindingId: 'binding-1',
      threadId: 'native-thread',
      turnId: 'turn-1',
      attemptId: 'attempt-1',
      generation: 1,
      input: { text: 'Hello' },
    }
    const turn = contribution.invoke({ envelope: envelope('turn.start', 'start-1'), payload })
    await vi.waitFor(() =>
      expect(server.requests.find((r) => r.method === 'turn/start')?.params.model).toBe(
        'gpt-6-luna'
      )
    )
    await contribution.invoke({ envelope: envelope('turn.cancel', 'cancel-1'), payload })
    await turn
    await contribution.dispose()
  })
  it('interrupts the matching active Turn through the Contribution interface', async () => {
    const server = createResponsiveAppServer()
    const contribution = createCodexContribution({
      activeHostId: 'host-1',
      configuration,
      boundary: server.boundary,
    })
    const payload = {
      bindingId: 'binding-1',
      threadId: 'native-thread',
      turnId: 'turn-1',
      attemptId: 'attempt-1',
      generation: 1,
      input: { text: 'Hello' },
    }
    const turn = contribution.invoke({ envelope: envelope('turn.start', 'start-1'), payload })
    await vi.waitFor(() =>
      expect(server.requests.some((r) => r.method === 'turn/start')).toBe(true)
    )
    await expect(
      contribution.invoke({ envelope: envelope('turn.cancel', 'cancel-1'), payload })
    ).resolves.toEqual({ accepted: true })
    expect(server.requests).toContainEqual(
      expect.objectContaining({
        method: 'turn/interrupt',
        params: { threadId: 'native-thread', turnId: 'native-turn' },
      })
    )
    await expect(turn).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'terminal', payload: { outcome: 'cancelled' } }),
      ])
    )
    await contribution.dispose()
  })
  it('settles an in-flight invocation when the app-server process exits', async () => {
    const appServer = createFakeAppServer()
    const contribution = createCodexContribution({
      activeHostId: 'local-host-1',
      configuration,
      boundary: appServer.boundary,
    })

    const ensure = contribution.invoke({
      envelope: envelope('thread.ensure', 'ensure-exit'),
      payload: {
        bindingId: 'binding-1',
        workspaceBindingId: 'workspace-1',
        conversationId: 'conversation-exit',
      },
    })
    expect(await settleState(ensure)).toBe('pending')

    appServer.emitExit()

    expect(await settleState(ensure)).toBe('rejected')

    await expect(ensure).rejects.toMatchObject({ code: 'codex_transport_closed' })
  })

  it('reports the app-server diagnostics when the process exits', async () => {
    const appServer = createFakeAppServer()
    const contribution = createCodexContribution({
      activeHostId: 'local-host-1',
      configuration,
      boundary: appServer.boundary,
    })

    const ensure = contribution.invoke({
      envelope: envelope('thread.ensure', 'ensure-diagnostics'),
      payload: {
        bindingId: 'binding-1',
        workspaceBindingId: 'workspace-1',
        conversationId: 'conversation-diagnostics',
      },
    })
    expect(await settleState(ensure)).toBe('pending')

    appServer.emitDiagnostic(
      'Error: failed to initialize sqlite state runtime under C:\\Users\\chen_\\.codex\n'
    )
    appServer.emitExit()

    const failure = (await ensure.catch((error: unknown) => error)) as Error
    expect(failure.message).toContain('sqlite state runtime')
  })
})

function createResponsiveAppServer(options: { invalidTurn?: boolean } = {}) {
  let receive: (data: string) => void = () => {}
  const requests: Array<{ id: number; method: string; params: Record<string, unknown> }> = []
  const emit = (value: unknown) => receive(`${JSON.stringify(value)}\n`)
  const boundary: CodexContributionBoundary = {
    detectExecutable: async () => true,
    detectVersion: async () => 'codex-cli 0.153.4',
    terminate: async () => undefined,
    start: async () => ({
      pid: 4242,
      channel: {
        onData: (handler) => {
          receive = handler
        },
        onExit: () => undefined,
        write: (line) => {
          const request = JSON.parse(line)
          requests.push(request)
          queueMicrotask(() => {
            if (request.id === undefined) return
            const result =
              request.method === 'initialize'
                ? {
                    codexHome: 'C:\\codex',
                    platformFamily: 'windows',
                    platformOs: 'windows',
                    userAgent: 'codex-cli/0.153.4',
                  }
                : request.method === 'turn/start'
                  ? {
                      turn: {
                        id: 'native-turn',
                        items: [],
                        status: options.invalidTurn ? 'unsupported' : 'inProgress',
                        error: null,
                      },
                    }
                  : {}
            emit({ jsonrpc: '2.0', id: request.id, result })
            if (request.method === 'turn/interrupt')
              emit({
                method: 'turn/completed',
                params: {
                  threadId: 'native-thread',
                  turn: { id: 'native-turn', items: [], status: 'interrupted', error: null },
                },
              })
          })
        },
      },
    }),
  }
  return { boundary, requests, emit }
}

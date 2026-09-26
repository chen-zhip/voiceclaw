import { cp, mkdtemp } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { describe, expect, it, vi } from 'vitest'
import { parseHarnessExecutionStream, type HarnessExecutionEvent } from '@voiceclaw/contracts'
import {
  DesktopHostCredentialStore,
  DesktopHostRuntime,
} from '../../../desktop/src/main/desktop-host/host-transport.js'
import { DesktopHostContributionRuntime } from '../../../desktop/src/main/desktop-host/host-contributions.js'
import {
  createCodexContribution,
  type CodexContributionBoundary,
} from '../../../desktop/src/main/providers/codex/codex-provider.js'
import { ActiveHostAssignmentService } from '../../src/desktop-host/active-assignment.js'
import { DesktopHostConnectionGateway } from '../../src/desktop-host/host-connection.js'
import { RemoteHostEnrollmentService } from '../../src/desktop-host/host-enrollment.js'
import { HostContributionRegistry } from '../../src/desktop-host/provider-registration.js'
import { HarnessSpeechDelivery } from '../../src/harness-execution/tts-delivery.js'
import { HarnessStreamRouter } from '../../src/harness-execution/stream-routing.js'
import { CapabilityGrantEvaluator } from '../../src/plugin-kernel/capability-grants.js'
import { ControlStateStore } from '../../src/plugin-kernel/control-state-store.js'
import { PhaseZeroKernel } from '../../src/plugin-kernel/phase-zero-kernel.js'
import { createRelayHttpApplication } from '../../src/relay-http-app.js'
import { createRelayServer } from '../../src/server-factory.js'
import { mountRelayWebSocketGateways } from '../../src/websocket-gateways.js'

const relayAuthority = { kind: 'relay-authority' as const, id: 'desktop-host-gateway' }
const selection = {
  bindingId: 'binding-1',
  hostId: 'host-1',
  providerId: 'codex',
  workspaceBindingId: 'workspace-1',
}
const configuration = {
  bindingId: 'binding-1',
  workspaceBindingId: 'workspace-1',
  workspacePath: 'C:\\workspaces\\private-project',
  executablePath: 'C:\\tools\\codex.exe',
  preferences: { model: 'gpt-5-codex', approvalPolicy: 'never' },
  secretRefs: { accountRef: 'os-secret://codex/account' },
}

describe('Relay to Host to Codex integration', () => {
  it('routes a real Codex Contribution Turn through the production boundaries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-codex-routing-'))
    const controlStatePath = join(directory, 'control-state.json')
    const packagesRoot = join(directory, 'packages')
    await cp(
      resolve(process.cwd(), '../desktop/src/main/providers/codex'),
      join(packagesRoot, 'voiceclaw-provider-codex'),
      { recursive: true }
    )
    const kernel = await createKernel(packagesRoot, controlStatePath)
    expect(kernel.effectiveGraph().packages.map((pluginPackage) => pluginPackage.id)).toEqual([
      'voiceclaw-provider-codex',
    ])
    const store = await ControlStateStore.open(controlStatePath, { requester: relayAuthority })
    const secrets = ['enrollment-token', 'host-credential']
    const enrollment = new RemoteHostEnrollmentService(store, {
      createSecret: () => secrets.shift() as string,
      createHostId: () => 'host-1',
      authorizeOwner: (principal) => principal.id === 'owner-1',
    })
    const connections = new DesktopHostConnectionGateway(store)
    const assignments = new ActiveHostAssignmentService(store, connections)
    const grants = new CapabilityGrantEvaluator(store)
    const registry = new HostContributionRegistry(connections)
    const app = createRelayHttpApplication({
      enrollment,
      authenticateOwner: async (credential) =>
        credential === 'owner-credential' ? { kind: 'user', id: 'owner-1' } : null,
    })
    const { server } = createRelayServer(app, {})
    const mounted = mountRelayWebSocketGateways(server, {
      hostGateway: connections,
      assignments,
      contributions: registry,
      kernel,
      authorizeInvocation: ({ envelope }) =>
        grants.authorize({
          principalId: envelope.principal.id,
          contractId: envelope.contract.id,
          operation: envelope.operation,
          scope: envelope.scope,
          workspaceBindingId: envelope.scope.id,
        }).authorized,
      onClientConnection: (socket) => socket.close(1000),
    })
    await new Promise<void>((resolve_) => server.listen(0, '127.0.0.1', resolve_))
    const port = (server.address() as AddressInfo).port

    const appServer = createDeterministicAppServer()
    const encryptedWrites: Buffer[] = []
    const socketCloses: Array<{ code: number; reason: string }> = []
    const contributions = new DesktopHostContributionRuntime(async () => [
      createCodexContribution({
        activeHostId: 'host-1',
        configuration,
        boundary: appServer.boundary,
        clientVersion: '0.10.51',
      }),
    ])
    let runtime: DesktopHostRuntime
    runtime = new DesktopHostRuntime({
      credentialStore: new DesktopHostCredentialStore(
        {
          isEncryptionAvailable: () => true,
          encryptString: () => Buffer.alloc(0),
          decryptString: () => 'host-credential',
        },
        {
          write: async (_hostId, value) => {
            encryptedWrites.push(value)
          },
          read: async () => ({ hostId: 'host-1', encryptedCredential: encryptedWrites[0] }),
          clear: async () => undefined,
        }
      ),
      createSocket: (_url, protocol, headers) =>
        (() => {
          const socket = new WebSocket(`ws://127.0.0.1:${port}/host/ws`, protocol, { headers })
          socket.on('close', (code, reason) => socketCloses.push({ code, reason: String(reason) }))
          return socket
        })(),
      lifecycle: {
        prepareConfiguration: async () => undefined,
        loadContributions: () => contributions.load(),
        connectHost: () => runtime.connectRemote('wss://relay.example/host/ws'),
        closeHost: () => contributions.dispose(),
        expireBootstrap: () => undefined,
      },
      invokeContribution: (input) => contributions.invoke(input),
      contributionRegistrations: () => contributions.registrations(),
    })

    try {
      const tokenResponse = await fetch(`http://127.0.0.1:${port}/host/enrollment-tokens`, {
        method: 'POST',
        headers: { authorization: 'Bearer owner-credential', 'content-type': 'application/json' },
        body: JSON.stringify({ installationId: 'installation-1' }),
      })
      const token = (await tokenResponse.json()) as { token: string }
      const enrollmentResponse = await fetch(`http://127.0.0.1:${port}/host/enrollments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token.token }),
      })
      const enrolled = (await enrollmentResponse.json()) as { hostId: string; credential: string }
      await runtime.storeRemoteCredential(enrolled)
      await runtime.start()
      await vi.waitFor(() =>
        expect(registry.projectHost('host-1')).toContainEqual(
          expect.objectContaining({
            contributionId: 'codex-provider',
            state: 'DEGRADED',
            callable: true,
            readiness: {
              executable: 'detected',
              process: 'stopped',
              transport: 'disconnected',
              session: 'unavailable',
            },
          })
        )
      )
      await runtime.reportReadiness({ ...selection, ready: true })
      const assignment = await mounted.hostControl.assign(relayAuthority, selection)

      const described = await mounted.hostControl.invoke({
        hostId: 'host-1',
        providerId: 'codex',
        envelope: { ...envelope(assignment.generation), operation: 'provider.describe' },
        payload: {},
        onEvent: () => undefined,
      })
      expect(described).toMatchObject({
        result: {
          providerId: 'codex',
          bindingId: 'binding-1',
          workspaceBindingId: 'workspace-1',
          profileStatus: 'exact',
          capabilityProfileVersion: '1.0.0',
        },
      })
      expect(JSON.stringify(described)).not.toMatch(
        /os-secret|private-project|tools|codex\.exe|gpt-5-codex|accountRef/i
      )

      const ensured = await mounted.hostControl.invoke({
        hostId: 'host-1',
        providerId: 'codex',
        envelope: {
          ...envelope(assignment.generation),
          operation: 'thread.ensure',
          invocationId: 'thread-invocation',
        },
        payload: {
          bindingId: 'binding-1',
          workspaceBindingId: 'workspace-1',
          conversationId: 'conversation-1',
        },
        onEvent: () => undefined,
      })
      expect(ensured).toEqual({ result: { threadId: 'native-thread-1', resumed: false } })

      const received: HarnessExecutionEvent[] = []
      const started = await mounted.hostControl.invoke({
        hostId: 'host-1',
        providerId: 'codex',
        envelope: envelope(assignment.generation),
        payload: turnPayload(assignment.generation),
        onEvent: (event) => received.push(event),
      })
      const events = (started as { events: HarnessExecutionEvent[] }).events
      expect(events).toEqual(received)
      expect(parseHarnessExecutionStream(events).success).toBe(true)
      expect(events.filter((event) => event.kind === 'terminal')).toEqual([
        expect.objectContaining({ payload: { outcome: 'completed' } }),
      ])
      const serialized = JSON.stringify(events)
      expect(serialized).toContain('Hello from Codex')
      expect(serialized).toMatch(/"channel":"speech"/)
      expect(serialized).toMatch(/"channel":"screen"/)
      expect(serialized).not.toMatch(/private chain of thought|rm -rf|reasoning-1|command-1/)
      expect(serialized).not.toMatch(/item\/|turn\/|thread\/tokenUsage/)

      const audio: string[] = []
      const screen: string[] = []
      const speech = new HarnessSpeechDelivery({
        tts: {
          connect: async () => undefined,
          synthesize: (text) => ({
            async *[Symbol.asyncIterator]() {
              yield { data: Buffer.from(`audio:${text}`).toString('base64') }
            },
          }),
          getPlaybackPosition: () => 0,
          stop: async () => undefined,
          disconnect: async () => undefined,
        },
        sendToClient: (event) => audio.push(event.data),
      })
      const router = new HarnessStreamRouter({
        activeAttempt: attemptIdentity(events[0]),
        speech,
        sendToClient: (event) => {
          if (event.type === 'harness.semantic-output') screen.push(event.text)
        },
      })
      for (const event of events) await router.route(event)
      expect(screen.join('')).toBe('Hello from Codex. Done.')
      expect(audio.map((data) => Buffer.from(data, 'base64').toString())).toEqual([
        'audio:Hello from Codex.',
        'audio:Done.',
      ])

      await expect(
        mounted.hostControl.invoke({
          hostId: 'host-1',
          providerId: 'codex',
          envelope: {
            ...envelope(assignment.generation - 1),
            invocationId: 'stale-invocation',
          },
          payload: { ...turnPayload(assignment.generation - 1), turnId: 'turn-stale' },
          onEvent: () => undefined,
        })
      ).rejects.toMatchObject({ code: 'stale_generation' })

      const graph = kernel.effectiveGraph()
      expect(graph.packages.map((pluginPackage) => pluginPackage.id)).toEqual([
        'voiceclaw-provider-codex',
      ])
      expect(graph.packages[0].contributions).toContainEqual(
        expect.objectContaining({
          id: 'codex-provider',
          state: 'ACTIVE',
          provides: expect.arrayContaining([{ id: 'harness.execution', version: '1.0.0' }]),
          requires: [],
        })
      )
      expect(graph.selectedProviders).toContainEqual(
        expect.objectContaining({ contractId: 'harness.execution' })
      )
      expect(JSON.stringify(encryptedWrites)).not.toContain('host-credential')
      const graphContributions = graph.packages.flatMap(
        (pluginPackage) => pluginPackage.contributions
      )
      expect(graphContributions.filter((contribution) => contribution.state === 'FAILED')).toEqual(
        []
      )
      expect(JSON.stringify(graph)).not.toMatch(/archive|memory/i)
      expect(socketCloses).toEqual([])

      for (const module of [
        'stream-routing.ts',
        'session-routing.ts',
        'dispatch.ts',
        'production-routing.ts',
        'tts-delivery.ts',
      ]) {
        const source = await readFile(
          resolve(process.cwd(), 'src/harness-execution', module),
          'utf8'
        )
        expect(source).not.toMatch(/\bcodex\b/i)
      }
    } finally {
      await runtime.stop()
      mounted.hostWebSocketServer.clients.forEach((socket) => socket.terminate())
      mounted.clientWebSocketServer.close()
      mounted.hostWebSocketServer.close()
      server.closeAllConnections()
      await new Promise<void>((resolve_) => server.close(() => resolve_()))
    }
  })
})

async function createKernel(packagesRoot: string, controlStatePath: string) {
  return PhaseZeroKernel.bootstrap({
    shippedRoots: [],
    developmentAllowlistedRoots: [packagesRoot],
    voiceclawVersion: '0.1.0',
    controlStatePath,
    selectedProviders: {
      'harness.execution': {
        packageId: 'voiceclaw-provider-codex',
        contributionId: 'codex-provider',
      },
    },
    configurations: {
      'voiceclaw-provider-codex:codex-provider': {
        executablePath: 'C:\\tools\\codex.exe',
        workspacePath: 'C:\\workspaces\\private-project',
        model: 'gpt-5-codex',
        approvalPolicy: 'never',
      },
    },
    assignments: [],
    grants: ['turn.start', 'provider.describe', 'thread.ensure', 'turn.cancel'].map(
      (operation) => ({
        id: `grant-routing-harness-execution-${operation}`,
        principalId: 'routing',
        contractId: 'harness.execution',
        operation,
        scope: { kind: 'workspace', id: 'workspace-1' },
        secretRefs: [],
        workspaceBindings: ['workspace-1'],
        revoked: false,
      })
    ),
    loadContribution: async () => ({
      invoke: async () => {
        throw new Error('desktop_host_transport_required')
      },
    }),
  })
}

function envelope(generation: number) {
  return {
    contract: { id: 'harness.execution', version: '1.0.0' },
    operation: 'turn.start',
    invocationId: 'invocation-1',
    principal: { kind: 'contribution' as const, id: 'routing' },
    scope: { kind: 'workspace', id: 'workspace-1' },
    selectedContribution: {
      packageId: 'voiceclaw-provider-codex',
      contributionId: 'codex-provider',
    },
    generation,
    trace: { traceId: 'trace-1' },
    cancellation: { supported: true, token: 'cancel-1' },
  }
}

function turnPayload(generation: number) {
  return {
    bindingId: 'binding-1',
    threadId: 'native-thread-1',
    turnId: 'turn-1',
    attemptId: 'attempt-1',
    generation,
    input: { text: 'Say hello' },
  }
}

function attemptIdentity(event: HarnessExecutionEvent) {
  const { sequence: _sequence, kind: _kind, payload: _payload, ...identity } = event
  return identity
}

function createDeterministicAppServer() {
  const listeners: Array<(chunk: string) => void> = []
  const terminated: number[] = []
  const emit = (message: unknown) => {
    for (const listener of listeners) listener(`${JSON.stringify(message)}\n`)
  }
  const usage = {
    inputTokens: 30,
    outputTokens: 12,
    totalTokens: 42,
    cachedInputTokens: 0,
    reasoningOutputTokens: 0,
  }
  const handle = (line: string) => {
    const request = JSON.parse(line) as { id: number; method: string }
    if (request.method === 'initialize') {
      emit({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          codexHome: 'C:\\codex',
          platformFamily: 'windows',
          platformOs: 'windows',
          userAgent: 'codex-cli/0.153.4',
        },
      })
      return
    }
    if (request.method === 'thread/start') {
      emit({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          approvalPolicy: 'never',
          approvalsReviewer: 'user',
          cwd: 'C:/workspace',
          model: 'test',
          modelProvider: 'openai',
          sandbox: { type: 'readOnly' },
          thread: {
            id: 'native-thread-1',
            cliVersion: '0.153.4',
            createdAt: 0,
            updatedAt: 0,
            cwd: 'C:/workspace',
            ephemeral: true,
            modelProvider: 'openai',
            preview: '',
            projectId: null,
            sessionId: 'session-1',
            source: 'appServer',
            status: { type: 'idle' },
            turns: [],
          },
        },
      })
      return
    }
    if (request.method === 'turn/start') {
      emit({
        jsonrpc: '2.0',
        id: request.id,
        result: { turn: { id: 'native-turn-1', items: [], status: 'inProgress' } },
      })
      emit({
        method: 'turn/started',
        params: {
          threadId: 'native-thread-1',
          turn: { id: 'native-turn-1', items: [], status: 'inProgress' },
        },
      })
      emit({
        method: 'item/reasoning/textDelta',
        params: {
          threadId: 'native-thread-1',
          turnId: 'native-turn-1',
          itemId: 'reasoning-1',
          delta: 'private chain of thought',
        },
      })
      emit({
        method: 'item/started',
        params: {
          threadId: 'native-thread-1',
          turnId: 'native-turn-1',
          startedAtMs: 1,
          item: {
            type: 'commandExecution',
            id: 'command-1',
            cwd: 'C:/workspace',
            commandActions: [],
            status: 'inProgress',
            command: 'rm -rf C:\\private',
          },
        },
      })
      const structuredResponse = JSON.stringify({
        speech: { content: 'Hello from Codex. Done.' },
        text: { content: 'Hello from Codex. Done.', format: 'plain' },
      })
      for (const delta of [structuredResponse.slice(0, 24), structuredResponse.slice(24)]) {
        emit({
          method: 'item/agentMessage/delta',
          params: {
            threadId: 'native-thread-1',
            turnId: 'native-turn-1',
            itemId: 'item-1',
            delta,
          },
        })
      }
      emit({
        method: 'item/completed',
        params: {
          threadId: 'native-thread-1',
          turnId: 'native-turn-1',
          completedAtMs: 3,
          item: { type: 'agentMessage', id: 'item-1', text: structuredResponse },
        },
      })
      emit({
        method: 'thread/tokenUsage/updated',
        params: {
          threadId: 'native-thread-1',
          turnId: 'native-turn-1',
          tokenUsage: { total: usage, last: usage },
        },
      })
      emit({
        method: 'turn/completed',
        params: {
          threadId: 'native-thread-1',
          turn: { id: 'native-turn-1', items: [], status: 'completed' },
        },
      })
      return
    }
    if (request.method === 'turn/interrupt') {
      emit({ jsonrpc: '2.0', id: request.id, result: {} })
      return
    }
    emit({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32601, message: `unsupported ${request.method}` },
    })
  }

  const boundary: CodexContributionBoundary = {
    detectExecutable: async (path) => path === 'C:\\tools\\codex.exe',
    detectVersion: async () => 'codex-cli 0.153.4',
    start: async () => ({
      pid: 900,
      channel: {
        write: handle,
        onData: (listener) => listeners.push(listener),
      },
    }),
    terminate: async (pid) => {
      terminated.push(pid)
    },
  }

  return { boundary, terminated }
}

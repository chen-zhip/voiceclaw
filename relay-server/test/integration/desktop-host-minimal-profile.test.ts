import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { describe, expect, it, vi } from 'vitest'
import {
  DesktopHostCredentialStore,
  DesktopHostRuntime,
} from '../../../desktop/src/main/desktop-host/host-transport.js'
import { DesktopHostContributionRuntime } from '../../../desktop/src/main/desktop-host/host-contributions.js'
import { ActiveHostAssignmentService } from '../../src/desktop-host/active-assignment.js'
import { DesktopHostConnectionGateway } from '../../src/desktop-host/host-connection.js'
import { RemoteHostEnrollmentService } from '../../src/desktop-host/host-enrollment.js'
import { HostContributionRegistry } from '../../src/desktop-host/provider-registration.js'
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

describe('Desktop Host minimal Profile', () => {
  it('starts the remote minimal Host Profile', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-remote-host-profile-'))
    const controlStatePath = join(directory, 'control-state.json')
    const kernel = await createKernel(directory, controlStatePath)
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
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const encryptedWrites: Buffer[] = []
    const contributionRuntime = createContributionRuntime('Hello from Codex')
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
        new WebSocket(`ws://127.0.0.1:${port}/host/ws`, protocol, { headers }),
      lifecycle: {
        prepareConfiguration: async () => undefined,
        loadContributions: () => contributionRuntime.load(),
        connectHost: () => runtime.connectRemote('wss://relay.example/host/ws'),
        closeHost: () => contributionRuntime.dispose(),
        expireBootstrap: () => undefined,
      },
      invokeContribution: (input) => contributionRuntime.invoke(input),
      contributionRegistrations: () => contributionRuntime.registrations(),
    })

    try {
      const tokenResponse = await fetch(`http://127.0.0.1:${port}/host/enrollment-tokens`, {
        method: 'POST',
        headers: { authorization: 'Bearer owner-credential', 'content-type': 'application/json' },
        body: JSON.stringify({ installationId: 'installation-1' }),
      })
      expect(tokenResponse.status).toBe(201)
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
        expect(registry.projectHost(enrolled.hostId)).toContainEqual(
          expect.objectContaining({
            contributionId: 'codex-provider',
            harnessVersion: '1.0.0',
            capabilityProfileVersion: '1.0.0',
            state: 'ACTIVE',
          })
        )
      )

      await runtime.reportReadiness({ ...selection, ready: true })
      const assignment = await mounted.hostControl.assign(relayAuthority, selection)
      await expect(
        mounted.hostControl.invoke({
          hostId: selection.hostId,
          providerId: selection.providerId,
          envelope: {
            ...envelope(assignment.generation),
            operation: 'provider.describe',
            invocationId: 'describe-1',
          },
          payload: {},
          onEvent: () => undefined,
        })
      ).resolves.toEqual({
        result: { providerId: 'codex', capabilityProfileVersion: '1.0.0' },
      })
      await expect(
        mounted.hostControl.invoke({
          hostId: selection.hostId,
          providerId: selection.providerId,
          envelope: {
            ...envelope(assignment.generation),
            operation: 'thread.ensure',
            invocationId: 'thread-1',
          },
          payload: {
            bindingId: 'binding-1',
            workspaceBindingId: 'workspace-1',
            conversationId: 'conversation-1',
          },
          onEvent: () => undefined,
        })
      ).resolves.toEqual({ result: { threadId: 'thread-1' } })
      const received: unknown[] = []
      await expect(
        mounted.hostControl.invoke({
          hostId: selection.hostId,
          providerId: selection.providerId,
          envelope: envelope(assignment.generation),
          payload: turnPayload(assignment.generation),
          onEvent: (value) => received.push(value),
        })
      ).resolves.toEqual({ events: received })

      expect(received).toEqual([
        expect.objectContaining({ kind: 'semantic-output', payload: { text: 'Hello from Codex' } }),
        expect.objectContaining({ kind: 'terminal', payload: { outcome: 'completed' } }),
      ])
      const graph = kernel.effectiveGraph()
      expect(graph.selectedProviders).toContainEqual(
        expect.objectContaining({ contractId: 'harness.execution' })
      )
      expect(graph.grantSummaries).toHaveLength(4)
      expect(graph.grantSummaries.every((grant) => grant.principalId === 'routing')).toBe(true)
      expect(JSON.stringify(graph)).not.toMatch(/archive|memory/i)
      expect(store.read()).toMatchObject({ hosts: [expect.objectContaining({ id: 'host-1' })] })
      expect(JSON.stringify(store.read())).not.toMatch(/Hello from Codex|messages|content/i)
      expect(JSON.stringify(encryptedWrites)).not.toContain('host-credential')
    } finally {
      await runtime.stop()
      mounted.hostWebSocketServer.clients.forEach((socket) => socket.terminate())
      mounted.clientWebSocketServer.close()
      mounted.hostWebSocketServer.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('starts the bundled-local minimal Host Profile', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-local-host-profile-'))
    const controlStatePath = join(directory, 'control-state.json')
    const kernel = await createKernel(directory, controlStatePath)
    const store = await ControlStateStore.open(controlStatePath, { requester: relayAuthority })
    const { BundledLocalHostBootstrap } = await import('../../src/desktop-host/host-connection.js')
    const bootstrap = new BundledLocalHostBootstrap({
      stackId: 'stack-1',
      hostId: 'host-1',
      createSecret: () => 'local-bootstrap-secret',
    })
    let enrollmentSecretsIssued = 0
    const enrollment = new RemoteHostEnrollmentService(store, {
      createSecret: () => {
        enrollmentSecretsIssued += 1
        return 'must-not-be-issued'
      },
      authorizeOwner: () => true,
    })
    const connections = new DesktopHostConnectionGateway(store, { localBootstrap: bootstrap })
    const assignments = new ActiveHostAssignmentService(store, connections)
    const grants = new CapabilityGrantEvaluator(store)
    const registry = new HostContributionRegistry(connections)
    const app = createRelayHttpApplication({ enrollment, authenticateOwner: async () => null })
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
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    let credentialWrites = 0
    const contributionRuntime = createContributionRuntime('Local response')
    let runtime: DesktopHostRuntime
    runtime = new DesktopHostRuntime({
      credentialStore: new DesktopHostCredentialStore(
        {
          isEncryptionAvailable: () => true,
          encryptString: () => Buffer.alloc(0),
          decryptString: () => '',
        },
        {
          write: async () => {
            credentialWrites += 1
          },
          read: async () => null,
          clear: async () => undefined,
        }
      ),
      createSocket: (_url, protocol, headers) =>
        new WebSocket(`ws://127.0.0.1:${port}/host/ws`, protocol, { headers }),
      invokeContribution: (input) => contributionRuntime.invoke(input),
      contributionRegistrations: () => contributionRuntime.registrations(),
      lifecycle: {
        prepareConfiguration: async () => undefined,
        loadContributions: () => contributionRuntime.load(),
        connectHost: () =>
          runtime.connectLocal(`ws://127.0.0.1:${port}/host/ws`, {
            VOICECLAW_LOCAL_HOST_BOOTSTRAP: bootstrap.credential(),
            VOICECLAW_LOCAL_HOST_STACK_ID: 'stack-1',
            VOICECLAW_LOCAL_HOST_ID: 'host-1',
          }),
        closeHost: () => contributionRuntime.dispose(),
        expireBootstrap: () => bootstrap.expire(),
      },
    })

    try {
      await runtime.start()
      await vi.waitFor(() =>
        expect(registry.projectHost('host-1')).toContainEqual(
          expect.objectContaining({ contributionId: 'codex-provider', state: 'ACTIVE' })
        )
      )
      await runtime.reportReadiness({ ...selection, ready: true })
      const assignment = await mounted.hostControl.assign(relayAuthority, selection)
      const received: unknown[] = []
      await expect(
        mounted.hostControl.invoke({
          hostId: 'host-1',
          providerId: 'codex',
          envelope: { ...envelope(assignment.generation), invocationId: 'local-invocation' },
          payload: turnPayload(assignment.generation),
          onEvent: (value) => received.push(value),
        })
      ).resolves.toEqual({ events: received })
      expect(received).toEqual([
        expect.objectContaining({ kind: 'semantic-output', payload: { text: 'Local response' } }),
        expect.objectContaining({ kind: 'terminal', payload: { outcome: 'completed' } }),
      ])
      expect(store.read().hosts).toEqual([])
      expect(enrollmentSecretsIssued).toBe(0)
      expect(credentialWrites).toBe(0)
      expect(JSON.stringify(store.read())).not.toMatch(
        /Local response|messages|content|archive|memory/i
      )
      await runtime.stop()
      expect(() => bootstrap.credential()).toThrow('expired')
    } finally {
      await runtime.stop()
      mounted.hostWebSocketServer.clients.forEach((socket) => socket.terminate())
      mounted.clientWebSocketServer.close()
      mounted.hostWebSocketServer.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

async function createKernel(directory: string, controlStatePath: string): Promise<PhaseZeroKernel> {
  const packagesRoot = join(directory, 'packages')
  const packageRoot = join(packagesRoot, 'voiceclaw-codex')
  await mkdir(join(packageRoot, 'dist'), { recursive: true })
  await writeFile(join(packageRoot, 'dist', 'provider.js'), 'export {}')
  await writeFile(
    join(packageRoot, 'voiceclaw.plugin.json'),
    JSON.stringify({
      manifestVersion: 0,
      id: 'voiceclaw-codex',
      version: '1.0.0',
      voiceclawVersionRange: '>=0.1.0 <0.2.0',
      feature: { id: 'codex', displayName: 'Codex' },
      contributions: [
        {
          id: 'codex-provider',
          type: 'provider-integration',
          runtime: 'desktop',
          entry: 'dist/provider.js',
          provides: [
            { id: 'harness.execution', version: '1.0.0' },
            { id: 'harness.capability-profile', version: '1.0.0' },
          ],
          requires: [],
          configSchema: { type: 'object' },
          requestedPermissions: [],
        },
      ],
      lifecycle: {
        activation: 'startup',
        disable: 'restart-required',
        update: 'restart-required',
        uninstall: 'unsupported',
        dataDisposition: 'retain',
      },
    })
  )
  return PhaseZeroKernel.bootstrap({
    shippedRoots: [],
    developmentAllowlistedRoots: [packagesRoot],
    voiceclawVersion: '0.1.0',
    controlStatePath,
    selectedProviders: {
      'harness.execution': { packageId: 'voiceclaw-codex', contributionId: 'codex-provider' },
    },
    configurations: {},
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
    loadContribution: async () => ({ invoke: async () => ({}) }),
  })
}

function envelope(generation: number) {
  return {
    contract: { id: 'harness.execution', version: '1.0.0' },
    operation: 'turn.start',
    invocationId: 'invocation-1',
    principal: { kind: 'contribution' as const, id: 'routing' },
    scope: { kind: 'workspace', id: 'workspace-1' },
    selectedContribution: { packageId: 'voiceclaw-codex', contributionId: 'codex-provider' },
    generation,
    trace: { traceId: 'trace-1' },
    cancellation: { supported: true, token: 'cancel-1' },
  }
}

function turnPayload(generation: number) {
  return {
    bindingId: 'binding-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    attemptId: 'attempt-1',
    generation,
    input: { text: 'Say hello' },
  }
}

function event(
  invocationId: string,
  payload: Record<string, unknown>,
  sequence: number,
  kind: 'semantic-output' | 'terminal',
  eventPayload: Record<string, unknown>
) {
  return {
    invocationId,
    bindingId: payload.bindingId,
    threadId: payload.threadId,
    turnId: payload.turnId,
    attemptId: payload.attemptId,
    generation: payload.generation,
    sequence,
    kind,
    payload: eventPayload,
  }
}

function createContributionRuntime(turnText: string): DesktopHostContributionRuntime {
  return new DesktopHostContributionRuntime(async () => [
    {
      packageId: 'voiceclaw-codex',
      contributionId: 'codex-provider',
      registration: {
        category: 'provider-integration',
        providerId: 'codex',
        harnessVersion: '1.0.0',
        capabilityProfileVersion: '1.0.0',
        provides: [
          { id: 'harness.execution', version: '1.0.0' },
          { id: 'harness.capability-profile', version: '1.0.0' },
        ],
        requires: [],
        state: 'ACTIVE',
        readiness: {
          executable: 'detected',
          process: 'running',
          transport: 'ready',
          session: 'ready',
        },
      },
      invoke: async ({ envelope, payload }) => {
        if (envelope.operation === 'provider.describe') {
          return { providerId: 'codex', capabilityProfileVersion: '1.0.0' }
        }
        if (envelope.operation === 'thread.ensure') return { threadId: 'thread-1' }
        if (envelope.operation === 'turn.cancel') return { accepted: true }
        return [
          event(envelope.invocationId, payload, 1, 'semantic-output', { text: turnText }),
          event(envelope.invocationId, payload, 2, 'terminal', { outcome: 'completed' }),
        ]
      },
    },
  ])
}

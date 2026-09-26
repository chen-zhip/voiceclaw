import type { HarnessExecutionEvent, KernelInvocationEnvelope } from '@voiceclaw/contracts'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadCodexAppServerSchema,
  validateCodexAppServerSchema,
  createCodexMessageValidator,
  CodexAppServerSchemaError,
} from './app-server-schema.js'
import type { DesktopHostContribution } from '../desktop-host/host-contributions.js'
import {
  CodexAvailabilityService,
  parseCodexNativeConfiguration,
  projectCodexAvailability,
  type CodexNativeConfiguration,
} from './codex-availability.js'
import { CodexAppServerSupervisor, codexProcessIdentity } from './app-server-process.js'
import { CodexAppServerTransport } from './app-server-transport.js'
import { CodexThreadRegistry } from './app-server-thread.js'
import { CodexTurnStream, type CodexTurnCorrelation } from './app-server-turn.js'
import {
  CODEX_PACKAGE_ID,
  CODEX_PROVIDER_CONTRIBUTION_ID,
  codexPluginManifest,
} from './codex-package.js'

export interface CodexProcessChannel {
  write(data: string): void
  onData(handler: (chunk: string) => void): void
  onDiagnostic?(handler: (chunk: string) => void): void
  onExit?(handler: () => void): void
}

export interface CodexContributionBoundary {
  detectExecutable(path: string): Promise<boolean>
  detectVersion(executablePath: string): Promise<string>
  start(input: {
    executablePath: string
    args: string[]
    cwd: string
  }): Promise<{ pid: number; channel: CodexProcessChannel }>
  terminate(pid: number): Promise<void>
}

export class CodexProviderError extends Error {
  constructor(
    readonly code:
      | 'codex_process_unavailable'
      | 'codex_operation_unsupported'
      | 'codex_turn_cancel_failed'
      | 'codex_provider_context_incomplete',
    message: string
  ) {
    super(message)
    this.name = 'CodexProviderError'
  }
}

interface CodexSession {
  transport: CodexAppServerTransport
  threads: CodexThreadRegistry
}

export function createCodexContribution(input: {
  activeHostId: string
  configuration: unknown
  boundary: CodexContributionBoundary
  clientVersion?: string
  requestTimeoutMs?: number
  turnIdleTimeoutMs?: number
  schemaDirectory?: string
}): DesktopHostContribution {
  const configuration = parseCodexNativeConfiguration(input.configuration)
  const identity = {
    activeHostId: input.activeHostId,
    nativeConfigurationIdentity: codexProcessIdentity(configuration),
  }
  const supervisor = new CodexAppServerSupervisor(input.boundary)
  const availability = new CodexAvailabilityService(input.boundary)
  const activeTurns = new Map<string, CodexTurnStream>()
  const activeTurnCorrelations = new Map<string, CodexTurnCorrelation>()
  let session: CodexSession | undefined

  async function openSession(): Promise<CodexSession> {
    if (session) return session
    const artifact = loadCodexAppServerSchema(
      input.schemaDirectory ??
        fileURLToPath(new URL('./app-server-schema/0.153.4', import.meta.url))
    )
    const validation = validateCodexAppServerSchema(artifact)
    if (!validation.valid)
      throw new CodexAppServerSchemaError('schema_artifact_invalid', validation.errors.join(', '))
    const ensured = await supervisor.ensure({
      identity,
      executablePath: configuration.executablePath,
      workspacePath: configuration.workspacePath,
    })
    const channel = ensured.channel
    if (!channel) {
      throw new CodexProviderError(
        'codex_process_unavailable',
        'Codex app-server process is not attached to this Contribution'
      )
    }
    const transport = new CodexAppServerTransport({
      validator: createCodexMessageValidator(artifact),
      write: (data) => channel.write(data),
      ...(input.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: input.requestTimeoutMs }),
    })
    const diagnostics = collectDiagnostics()
    transport.onProtocolError(() => {
      if (transport.state !== 'drained') return
      session = undefined
      for (const turn of activeTurns.values()) turn.transportLost()
    })
    channel.onData((chunk) => transport.receive(chunk))
    channel.onDiagnostic?.((chunk) => diagnostics.push(chunk))
    channel.onExit?.(() => {
      supervisor.reportStopped(identity)
      session = undefined
      // An app-server that dies mid-handshake must settle the requests it can
      // no longer answer; otherwise the Host never replies and the Relay keeps
      // the binding occupied by an attempt that can never finish.
      transport.drain('codex_transport_closed', diagnostics.summary())
      for (const turn of activeTurns.values()) turn.transportLost()
      activeTurns.clear()
      activeTurnCorrelations.clear()
    })
    try {
      await transport.initialize({
        name: 'voiceclaw-desktop',
        version: input.clientVersion ?? '0.0.0',
      })
    } catch (error) {
      transport.drain('codex_protocol_error')
      throw error
    }
    supervisor.reportTransport(identity, true)
    supervisor.reportSession(identity, true)
    const opened: CodexSession = {
      transport,
      threads: new CodexThreadRegistry({
        request: (method, params) => transport.request(method, params),
      }),
    }
    transport.onNotification((notification) => {
      for (const turn of activeTurns.values()) turn.dispatch(notification)
    })
    session = opened
    return opened
  }

  async function describe() {
    const detectedVersion = await input.boundary.detectVersion(configuration.executablePath)
    const status = runtimeStatus()
    const descriptor = await availability.describe({
      configuration,
      detectedVersion,
      runtime: status,
    })
    return projectCodexAvailability(descriptor)
  }

  function runtimeStatus(): {
    process: 'starting' | 'running' | 'stopped' | 'failed'
    transport: 'disconnected' | 'ready'
    session: 'unavailable' | 'ready'
  } {
    try {
      const status = supervisor.status(identity)
      return {
        process: status.process === 'running' ? 'running' : 'stopped',
        transport: status.transport,
        session: status.session,
      }
    } catch {
      return { process: 'stopped', transport: 'disconnected', session: 'unavailable' }
    }
  }

  return {
    packageId: CODEX_PACKAGE_ID,
    contributionId: CODEX_PROVIDER_CONTRIBUTION_ID,
    registration: {
      category: 'provider-integration',
      providerId: codexPluginManifest.feature.id,
      harnessVersion:
        codexPluginManifest.contributions[0].provides.find(
          (contract) => contract.id === 'harness.execution'
        )?.version ?? '1.0.0',
      capabilityProfileVersion:
        codexPluginManifest.contributions[0].provides.find(
          (contract) => contract.id === 'harness.capability-profile'
        )?.version ?? '1.0.0',
      provides: codexPluginManifest.contributions[0].provides.map((contract) => ({ ...contract })),
      requires: [],
      state: 'ACTIVE',
      readiness: {
        executable: 'detected',
        process: 'stopped',
        transport: 'disconnected',
        session: 'unavailable',
      },
    },
    async invoke(request: {
      envelope: KernelInvocationEnvelope
      payload: Record<string, unknown>
      onEvent?: (event: unknown) => void
    }): Promise<unknown> {
      const { envelope, payload } = request
      if (envelope.operation === 'provider.describe') return describe()
      if (envelope.operation === 'turn.cancel') {
        const active = activeTurns.get(String(payload.attemptId))
        const correlation = activeTurnCorrelations.get(String(payload.attemptId))
        if (
          !active ||
          !correlation ||
          correlation.bindingId !== payload.bindingId ||
          correlation.threadId !== payload.threadId ||
          correlation.turnId !== payload.turnId ||
          correlation.generation !== payload.generation ||
          envelope.generation !== correlation.generation
        ) {
          throw new CodexProviderError(
            'codex_turn_cancel_failed',
            'No matching active Codex Turn can be interrupted'
          )
        }
        await active.cancel({ correlation })
        return { accepted: true }
      }
      if (envelope.operation === 'thread.ensure') {
        const opened = await openSession()
        const ensured = await opened.threads.ensure({
          mapping: {
            conversationId: String(payload.conversationId),
            providerId: codexPluginManifest.feature.id,
            workspaceBindingId: String(payload.workspaceBindingId),
          },
          workspacePath: configuration.workspacePath,
        })
        return { threadId: ensured.threadId, resumed: ensured.resumed }
      }
      if (envelope.operation === 'turn.start') {
        const opened = await openSession()
        const correlation: CodexTurnCorrelation = {
          invocationId: envelope.invocationId,
          bindingId: String(payload.bindingId),
          threadId: String(payload.threadId),
          turnId: String(payload.turnId),
          attemptId: String(payload.attemptId),
          generation: Number(payload.generation),
        }
        const active = new CodexTurnStream({
          request: (method, params) => opened.transport.request(method, params),
          ...(input.turnIdleTimeoutMs === undefined
            ? {}
            : { idleTimeoutMs: input.turnIdleTimeoutMs }),
        })
        const events: HarnessExecutionEvent[] = []
        active.onEvent((event) => {
          events.push(event)
          request.onEvent?.(event)
        })
        activeTurns.set(correlation.attemptId, active)
        activeTurnCorrelations.set(correlation.attemptId, correlation)
        try {
          await active.start({
            correlation,
            nativeThreadId: correlation.threadId,
            text: String((payload.input as { text?: unknown } | undefined)?.text ?? ''),
            ...(typeof configuration.preferences.model === 'string' &&
            configuration.preferences.model.trim()
              ? { model: configuration.preferences.model.trim() }
              : {}),
          })
          await active.terminal
        } finally {
          activeTurns.delete(correlation.attemptId)
          activeTurnCorrelations.delete(correlation.attemptId)
        }
        return events
      }
      throw new CodexProviderError(
        'codex_operation_unsupported',
        `Codex does not implement the ${envelope.operation} operation`
      )
    },
    async dispose(): Promise<void> {
      activeTurns.clear()
      activeTurnCorrelations.clear()
      session = undefined
      await supervisor.shutdown()
    },
  }
}

export type { CodexNativeConfiguration }

const DIAGNOSTIC_LINE_LIMIT = 3
const DIAGNOSTIC_CHARACTER_LIMIT = 400

// The app-server reports its own failures on stderr. A bounded tail is enough
// to tell an operator what happened without echoing unbounded provider logging
// into the error a user sees.
function collectDiagnostics(): { push(chunk: string): void; summary(): string | undefined } {
  let received = ''
  return {
    push(chunk: string) {
      received = `${received}${chunk}`.slice(-DIAGNOSTIC_CHARACTER_LIMIT * 2)
    },
    summary() {
      const lines = received
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(-DIAGNOSTIC_LINE_LIMIT)
      if (lines.length === 0) return undefined
      return lines.join(' | ').slice(0, DIAGNOSTIC_CHARACTER_LIMIT)
    },
  }
}

export interface CodexProviderEntry {
  invoke(input: {
    envelope: KernelInvocationEnvelope
    payload: Record<string, unknown>
  }): Promise<unknown>
  dispose?(): Promise<void>
}

export interface CodexPackageEntryContext {
  packageRoot: string
  manifest: unknown
  contribution: unknown
  activeHostId: string
  nativeConfiguration: unknown
  boundary: unknown
}

export function createProviderContribution(context: CodexPackageEntryContext): CodexProviderEntry {
  if (!context.nativeConfiguration || !context.boundary) {
    throw new CodexProviderError(
      'codex_provider_context_incomplete',
      'Codex needs a Native Provider Configuration and a Provider process boundary to load'
    )
  }
  const contribution = createCodexContribution({
    activeHostId: context.activeHostId,
    configuration: context.nativeConfiguration,
    boundary: context.boundary as CodexContributionBoundary,
    schemaDirectory: join(context.packageRoot, 'app-server-schema', '0.153.4'),
  })
  return {
    invoke: (input) => contribution.invoke(input),
    ...(contribution.dispose ? { dispose: () => contribution.dispose?.() as Promise<void> } : {}),
  }
}

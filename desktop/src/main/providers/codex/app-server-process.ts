import { createHash } from 'node:crypto'
import { selectCodexCapabilityProfile } from './codex-profile.js'

export interface CodexProcessIdentity {
  activeHostId: string
  nativeConfigurationIdentity: string
}

export interface CodexProcessDefiningConfiguration {
  executablePath?: string
  preferences?: Record<string, unknown>
  secretRefs?: Record<string, unknown>
}

export type CodexProcessOwnership = 'started' | 'external'

export interface CodexAppServerProcessChannel {
  write(data: string): void
  onData(handler: (chunk: string) => void): void
  onExit?(handler: () => void): void
}

export interface CodexAppServerProcessStatus {
  activeHostId: string
  nativeConfigurationIdentity: string
  pid: number
  process: 'running' | 'stopped'
  transport: 'disconnected' | 'ready'
  session: 'unavailable' | 'ready'
  ownership: CodexProcessOwnership
}

export class CodexAppServerProcessError extends Error {
  constructor(
    readonly code: 'codex_executable_not_found' | 'codex_process_not_found',
    message: string
  ) {
    super(message)
    this.name = 'CodexAppServerProcessError'
  }
}

export function codexProcessIdentity(configuration: CodexProcessDefiningConfiguration): string {
  const settings = selectCodexCapabilityProfile('0.153.4').profile.processDefiningSettings
  const resolved = settings.map((setting) => [setting, resolveSetting(setting, configuration)])
  resolved.sort(([left], [right]) => (left < right ? -1 : 1))
  return `codex-config-${createHash('sha256').update(JSON.stringify(resolved)).digest('hex')}`
}

function resolveSetting(
  setting: string,
  configuration: CodexProcessDefiningConfiguration
): unknown {
  if (setting === 'executablePath') return configuration.executablePath ?? 'codex'
  if (configuration.preferences && setting in configuration.preferences) {
    return configuration.preferences[setting]
  }
  if (configuration.secretRefs && setting in configuration.secretRefs) {
    return configuration.secretRefs[setting]
  }
  return undefined
}

export class CodexAppServerSupervisor {
  readonly #records = new Map<string, CodexAppServerProcessStatus>()
  readonly #channels = new Map<string, CodexAppServerProcessChannel>()

  constructor(
    private readonly boundary: {
      detectExecutable(path: string): Promise<boolean>
      start(input: {
        executablePath: string
        args: string[]
        cwd: string
      }): Promise<{ pid: number; channel?: CodexAppServerProcessChannel }>
      terminate(pid: number): Promise<void>
    }
  ) {}

  async ensure(input: {
    identity: CodexProcessIdentity
    executablePath: string
    workspacePath: string
  }): Promise<{
    pid: number
    reused: boolean
    ownership: CodexProcessOwnership
    channel?: CodexAppServerProcessChannel
  }> {
    const key = processKey(input.identity)
    const record = this.#records.get(key)
    if (record && record.process === 'running') {
      const channel = this.#channels.get(key)
      return {
        pid: record.pid,
        reused: true,
        ownership: record.ownership,
        ...(channel ? { channel } : {}),
      }
    }
    if (!(await this.boundary.detectExecutable(input.executablePath))) {
      throw new CodexAppServerProcessError(
        'codex_executable_not_found',
        'Codex app-server executable is missing'
      )
    }
    const started = await this.boundary.start({
      executablePath: input.executablePath,
      args: ['app-server'],
      cwd: input.workspacePath,
    })
    this.#records.set(key, {
      ...input.identity,
      pid: started.pid,
      process: 'running',
      transport: 'disconnected',
      session: 'unavailable',
      ownership: 'started',
    })
    if (started.channel) this.#channels.set(key, started.channel)
    return {
      pid: started.pid,
      reused: false,
      ownership: 'started',
      ...(started.channel ? { channel: started.channel } : {}),
    }
  }

  async connectExternal(identity: CodexProcessIdentity, input: { pid: number }): Promise<void> {
    this.#records.set(processKey(identity), {
      ...identity,
      pid: input.pid,
      process: 'running',
      transport: 'disconnected',
      session: 'unavailable',
      ownership: 'external',
    })
  }

  reportTransport(identity: CodexProcessIdentity, ready: boolean): void {
    const record = this.#record(identity)
    record.transport = ready ? 'ready' : 'disconnected'
    if (!ready) record.session = 'unavailable'
  }

  reportSession(identity: CodexProcessIdentity, ready: boolean): void {
    this.#record(identity).session = ready ? 'ready' : 'unavailable'
  }

  reportStopped(identity: CodexProcessIdentity): void {
    const record = this.#records.get(processKey(identity))
    if (!record) return
    record.process = 'stopped'
    record.transport = 'disconnected'
    record.session = 'unavailable'
  }

  status(identity: CodexProcessIdentity): CodexAppServerProcessStatus {
    return structuredClone(this.#record(identity))
  }

  async shutdown(): Promise<void> {
    for (const record of this.#records.values()) {
      if (record.process !== 'running' || record.ownership === 'external') continue
      await this.boundary.terminate(record.pid)
      record.process = 'stopped'
      record.transport = 'disconnected'
      record.session = 'unavailable'
    }
  }

  #record(identity: CodexProcessIdentity): CodexAppServerProcessStatus {
    const record = this.#records.get(processKey(identity))
    if (!record) {
      throw new CodexAppServerProcessError(
        'codex_process_not_found',
        'Codex app-server process is unknown'
      )
    }
    return record
  }
}

function processKey(identity: CodexProcessIdentity): string {
  return `${identity.activeHostId}\u0000${identity.nativeConfigurationIdentity}`
}

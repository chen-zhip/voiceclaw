import WebSocket from 'ws'
import {
  parseHarnessExecutionRequest,
  parseHarnessExecutionResult,
  parseHarnessExecutionStream,
  parseKernelInvocationEnvelope,
  type HarnessExecutionEvent,
  type KernelInvocationEnvelope,
} from '@voiceclaw/contracts'
import type {
  NativeProviderConfiguration,
  NativeProviderConfigurationService,
} from './native-provider-configuration.js'
import type { ProviderProcessSupervisor } from './provider-process.js'

export interface HostSecureStorage {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export interface HostCredentialPersistence {
  write(hostId: string, encryptedCredential: Buffer): Promise<void>
  read(): Promise<{ hostId: string; encryptedCredential: Buffer } | null>
  clear(): Promise<void>
}

export interface HostTransportSocket {
  on(event: string | symbol, listener: (...arguments_: any[]) => void): this
  once(event: string | symbol, listener: (...arguments_: any[]) => void): this
  send?(data: string): void
  close(): void
}

export type CreateHostTransportSocket = (
  url: string,
  protocol: string,
  headers: Record<string, string>
) => HostTransportSocket

type DesktopHostRuntimeState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'

export class DesktopHostCredentialStore {
  constructor(
    private readonly secureStorage: HostSecureStorage,
    private readonly persistence: HostCredentialPersistence
  ) {}

  async save(hostId: string, credential: string): Promise<void> {
    if (!this.secureStorage.isEncryptionAvailable()) {
      throw new Error('host_secure_storage_unavailable')
    }
    const encryptedCredential = this.secureStorage.encryptString(credential)
    await this.persistence.write(hostId, encryptedCredential)
  }

  async load(): Promise<{ hostId: string; credential: string } | null> {
    if (!this.secureStorage.isEncryptionAvailable()) return null
    const stored = await this.persistence.read()
    if (!stored) return null
    return {
      hostId: stored.hostId,
      credential: this.secureStorage.decryptString(stored.encryptedCredential),
    }
  }

  clear(): Promise<void> {
    return this.persistence.clear()
  }
}

export class DesktopHostRuntime {
  #remoteUrl: string | undefined
  #localConnection: { url: string; environment: NodeJS.ProcessEnv } | undefined
  #hostId: string | undefined
  #socket: HostTransportSocket | undefined
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined
  #state: DesktopHostRuntimeState = 'idle'
  readonly #pendingReadiness: Array<{
    identity: {
      bindingId: string
      providerId: string
      workspaceBindingId: string
      ready: boolean
    }
    resolve(): void
    reject(error: Error): void
  }> = []
  #acceptedReadiness: Array<{
    bindingId: string
    providerId: string
    workspaceBindingId: string
    ready: boolean
  }> = []

  constructor(
    private readonly options: {
      credentialStore: DesktopHostCredentialStore
      configuration?: NativeProviderConfigurationService
      processes?: ProviderProcessSupervisor
      lifecycle?: {
        prepareConfiguration(): Promise<unknown>
        loadContributions(): Promise<unknown>
        connectHost(): Promise<unknown>
        closeHost(): Promise<unknown>
        expireBootstrap(): void
      }
      createSocket?: CreateHostTransportSocket
      invokeContribution?(input: {
        envelope: KernelInvocationEnvelope
        payload: Record<string, unknown>
      }): Promise<unknown>
      contributionRegistrations?(): Array<Record<string, unknown>>
      reconnectDelayMs?: number
      log?: (line: string) => void
    }
  ) {}

  async start(): Promise<void> {
    if (this.#state === 'running' || this.#state === 'starting') return
    this.#state = 'starting'
    try {
      await this.options.lifecycle?.prepareConfiguration()
      await this.options.lifecycle?.loadContributions()
      await this.options.lifecycle?.connectHost()
      this.#state = 'running'
    } catch (error) {
      this.#state = 'failed'
      throw error
    }
  }

  async stop(): Promise<void> {
    if (
      this.#state === 'stopped' ||
      this.#state === 'stopping' ||
      (this.#state === 'idle' && !this.#socket && !this.#reconnectTimer)
    )
      return
    this.#state = 'stopping'
    try {
      if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = undefined
      this.#socket?.close()
      this.#socket = undefined
      await this.options.lifecycle?.closeHost()
      this.options.lifecycle?.expireBootstrap()
      await this.options.processes?.shutdown()
    } finally {
      this.#state = 'stopped'
    }
  }

  status(): { state: DesktopHostRuntimeState } {
    return { state: this.#state }
  }

  async storeRemoteCredential(input: { hostId: string; credential: string }): Promise<void> {
    await this.options.credentialStore.save(input.hostId, input.credential)
    this.#hostId = input.hostId
    this.options.log?.(`[desktop-host] stored credential for ${input.hostId}`)
  }

  async saveNativeProviderConfiguration(configuration: NativeProviderConfiguration): Promise<void> {
    if (!this.options.configuration) throw new Error('native_configuration_unavailable')
    await this.options.configuration.save(configuration)
  }

  async projectNativeProviderReadiness(
    bindingId: string,
    readiness: { configured: boolean; executableDetected: boolean; [key: string]: unknown }
  ) {
    if (!this.options.configuration) throw new Error('native_configuration_unavailable')
    return this.options.configuration.projectReadiness(bindingId, readiness)
  }

  async connectRemote(url: string): Promise<void> {
    if (new URL(url).protocol !== 'wss:') throw new Error('secure_wss_required')
    this.#remoteUrl = url
    await this.#openRemoteSocket()
  }

  async connectLocal(url: string, environment: NodeJS.ProcessEnv): Promise<void> {
    const protocol = new URL(url).protocol
    if (protocol !== 'ws:' && protocol !== 'wss:') throw new Error('invalid_host_url')
    const secret = environment.VOICECLAW_LOCAL_HOST_BOOTSTRAP
    const stackId = environment.VOICECLAW_LOCAL_HOST_STACK_ID
    if (!secret || !stackId) throw new Error('local_host_bootstrap_unavailable')
    this.#localConnection = { url, environment: { ...environment } }
    const createSocket = this.options.createSocket ?? defaultCreateSocket
    const socket = createSocket(url, 'voiceclaw.host.v1', {
      'x-voiceclaw-local-host-bootstrap': secret,
      'x-voiceclaw-local-host-stack-id': stackId,
    })
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', (error) => reject(error))
    })
    this.#socket?.close()
    this.#socket = socket
    this.#attachSocket(socket)
    this.#replayReadiness(socket)
    this.#registerContributions(socket)
    this.#hostId = environment.VOICECLAW_LOCAL_HOST_ID
  }

  async reconnectRemote(): Promise<void> {
    if (!this.#remoteUrl) throw new Error('remote_host_url_not_configured')
    await this.#openRemoteSocket()
  }

  async reportReadiness(input: {
    bindingId: string
    providerId: string
    workspaceBindingId: string
    ready: boolean
  }): Promise<void> {
    if (!this.#socket?.send) throw new Error('host_socket_unavailable')
    const accepted = new Promise<void>((resolve, reject) => {
      this.#pendingReadiness.push({
        identity: {
          bindingId: input.bindingId,
          providerId: input.providerId,
          workspaceBindingId: input.workspaceBindingId,
          ready: input.ready,
        },
        resolve,
        reject,
      })
    })
    this.#socket.send(
      JSON.stringify({
        version: 1,
        type: 'host.readiness.report',
        bindingId: input.bindingId,
        providerId: input.providerId,
        workspaceBindingId: input.workspaceBindingId,
        ready: input.ready,
      })
    )
    return accepted
  }

  describe(): { mode: 'remote'; hostId?: string; url?: string; connected: boolean } {
    return {
      mode: 'remote',
      ...(this.#hostId ? { hostId: this.#hostId } : {}),
      ...(this.#remoteUrl ? { url: this.#remoteUrl } : {}),
      connected: this.#socket !== undefined,
    }
  }

  async #openRemoteSocket(): Promise<void> {
    const stored = await this.options.credentialStore.load()
    if (!stored) throw new Error('host_credential_not_found')
    const createSocket = this.options.createSocket ?? defaultCreateSocket
    const socket = createSocket(this.#remoteUrl as string, 'voiceclaw.host.v1', {
      authorization: `Host ${stored.credential}`,
    })
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', (error) => reject(error))
    })
    this.#socket?.close()
    this.#socket = socket
    this.#attachSocket(socket)
    this.#replayReadiness(socket)
    this.#registerContributions(socket)
    this.#hostId = stored.hostId
    this.options.log?.(`[desktop-host] connected ${stored.hostId}`)
  }

  #attachSocket(socket: HostTransportSocket): void {
    socket.on('message', (data) => {
      void this.#handleFrame(socket, data).catch(() => socket.close())
    })
    socket.once('close', () => {
      const wasCurrent = this.#socket === socket
      if (wasCurrent) this.#socket = undefined
      for (const pending of this.#pendingReadiness) {
        pending.reject(new Error('host_socket_closed'))
      }
      this.#pendingReadiness.length = 0
      if (wasCurrent) this.#scheduleReconnect()
    })
  }

  #scheduleReconnect(): void {
    if (
      this.#reconnectTimer ||
      this.#state === 'stopping' ||
      this.#state === 'stopped' ||
      (!this.#remoteUrl && !this.#localConnection)
    )
      return
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined
      const reconnect = this.#remoteUrl
        ? this.#openRemoteSocket()
        : this.connectLocal(
            (this.#localConnection as { url: string }).url,
            (this.#localConnection as { environment: NodeJS.ProcessEnv }).environment
          )
      void reconnect.catch(() => this.#scheduleReconnect())
    }, this.options.reconnectDelayMs ?? 1_000)
  }

  async #handleFrame(socket: HostTransportSocket, data: unknown): Promise<void> {
    const frame = JSON.parse(String(data)) as Record<string, unknown>
    if (frame.version !== 1 || typeof frame.type !== 'string') {
      throw new Error('invalid_host_frame')
    }
    if (frame.type === 'host.readiness.accepted') {
      const index = this.#pendingReadiness.findIndex((pending) =>
        sameReadinessIdentity(pending.identity, frame)
      )
      if (index < 0) return
      const [pending] = this.#pendingReadiness.splice(index, 1)
      const readiness = pending.identity
      this.#acceptedReadiness = [
        ...this.#acceptedReadiness.filter(
          (candidate) => !sameReadinessIdentity(candidate, readiness)
        ),
        readiness,
      ]
      pending.resolve()
      return
    }
    if (frame.type === 'host.assignment') return
    if (
      (frame.type !== 'host.invocation.request' && frame.type !== 'host.invocation.cancel') ||
      !this.options.invokeContribution ||
      !socket.send
    ) {
      throw new Error('invalid_host_frame')
    }
    const parsedEnvelope = parseKernelInvocationEnvelope(frame.envelope)
    if (!parsedEnvelope.success) throw new Error('invalid_host_invocation')
    const parsedRequest = parseHarnessExecutionRequest({
      operation: parsedEnvelope.data.operation,
      payload: frame.payload,
    })
    if (!parsedRequest.success) throw new Error('invalid_host_invocation')
    const output = await this.options.invokeContribution({
      envelope: parsedEnvelope.data,
      payload: parsedRequest.data.payload,
    })
    if (frame.type === 'host.invocation.cancel') return
    if (parsedEnvelope.data.operation !== 'turn.start') {
      const result = parseHarnessExecutionResult(parsedEnvelope.data.operation, output)
      if (!result.success) throw new Error('invalid_host_output')
      socket.send(
        JSON.stringify({
          version: 1,
          type: 'host.invocation.result',
          invocationId: parsedEnvelope.data.invocationId,
          generation: parsedEnvelope.data.generation,
          result: result.data,
        })
      )
      return
    }
    const stream = parseHarnessExecutionStream(output)
    if (!stream.success) throw new Error('invalid_host_output')
    for (const event of stream.data as HarnessExecutionEvent[]) {
      socket.send(JSON.stringify({ version: 1, type: 'host.invocation.event', event }))
    }
  }

  #replayReadiness(socket: HostTransportSocket): void {
    if (!socket.send) return
    for (const readiness of this.#acceptedReadiness) {
      socket.send(
        JSON.stringify({
          version: 1,
          type: 'host.readiness.report',
          ...readiness,
        })
      )
    }
  }

  #registerContributions(socket: HostTransportSocket): void {
    if (!socket.send) return
    for (const registration of this.options.contributionRegistrations?.() ?? []) {
      socket.send(
        JSON.stringify({
          version: 1,
          type: 'host.contribution.register',
          registration,
        })
      )
    }
  }
}

function sameReadinessIdentity(
  left: { bindingId: string; providerId: string; workspaceBindingId: string },
  right: Record<string, unknown>
): boolean {
  return (
    left.bindingId === right.bindingId &&
    left.providerId === right.providerId &&
    left.workspaceBindingId === right.workspaceBindingId
  )
}

function defaultCreateSocket(
  url: string,
  protocol: string,
  headers: Record<string, string>
): HostTransportSocket {
  return new WebSocket(url, protocol, { headers })
}

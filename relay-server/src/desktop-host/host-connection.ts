import { verifySecret } from './host-enrollment.js'
import { ControlStateStore } from '../plugin-kernel/control-state-store.js'
import { createHash, randomBytes } from 'node:crypto'

type HostCredential = {
  kind: 'host' | 'client' | 'provider' | 'local-bootstrap'
  value: string
}

export class BundledLocalHostBootstrap {
  readonly stackId: string
  readonly hostId: string
  #secret: string | undefined

  constructor(options: { stackId: string; hostId: string; createSecret?: () => string }) {
    this.stackId = options.stackId
    this.hostId = options.hostId
    this.#secret = (options.createSecret ?? (() => randomBytes(32).toString('base64url')))()
  }

  credential(): string {
    if (!this.#secret) throw new Error('Local Host Bootstrap Secret has expired')
    return this.#secret
  }

  authenticate(stackId: string, secret: string): boolean {
    return (
      this.#secret !== undefined &&
      stackId === this.stackId &&
      verifySecret(secret, secretVerifier(this.#secret))
    )
  }

  expire(): void {
    this.#secret = undefined
  }
}

export class HostConnectionError extends Error {
  constructor(
    readonly code: 'host_authentication_failed',
    message: string
  ) {
    super(message)
    this.name = 'HostConnectionError'
  }
}

export class DesktopHostConnectionGateway {
  readonly #connectedHostIds = new Set<string>()

  constructor(
    private readonly store: ControlStateStore,
    private readonly options: {
      now?: () => number
      localBootstrap?: BundledLocalHostBootstrap
    } = {}
  ) {}

  async admit(
    input:
      | { mode: 'remote'; credential: HostCredential }
      | { mode: 'local'; stackId: string; credential: HostCredential }
  ) {
    if (input.mode === 'local') {
      if (
        input.credential.kind !== 'local-bootstrap' ||
        !this.options.localBootstrap?.authenticate(input.stackId, input.credential.value)
      ) {
        return this.#reject()
      }
      this.#connectedHostIds.add(this.options.localBootstrap.hostId)
      return { kind: 'desktop-host' as const, id: this.options.localBootstrap.hostId }
    }
    if (input.credential.kind !== 'host') return this.#reject()
    const now = (this.options.now ?? Date.now)()
    const host = this.store.read().hosts.find((candidate) => {
      if (
        candidate.revoked ||
        !candidate.credentialVerifier ||
        (candidate.credentialExpiresAt !== null &&
          candidate.credentialExpiresAt !== undefined &&
          Date.parse(candidate.credentialExpiresAt) < now)
      ) {
        return false
      }
      return verifySecret(input.credential.value, candidate.credentialVerifier)
    })
    if (!host) return this.#reject()

    await this.store.commit((state) => ({
      ...state,
      hosts: state.hosts.map((candidate) =>
        candidate.id === host.id
          ? { ...candidate, lastActivityAt: new Date(now).toISOString() }
          : candidate
      ),
    }))
    this.#connectedHostIds.add(host.id)
    return { kind: 'desktop-host' as const, id: host.id }
  }

  isConnected(hostId: string): boolean {
    return this.#connectedHostIds.has(hostId)
  }

  isLocallyAuthenticated(hostId: string): boolean {
    return this.isConnected(hostId) && this.options.localBootstrap?.hostId === hostId
  }

  disconnect(hostId: string): void {
    this.#connectedHostIds.delete(hostId)
  }

  #reject(): never {
    throw new HostConnectionError(
      'host_authentication_failed',
      'Desktop Host authentication failed'
    )
  }
}

function secretVerifier(secret: string): string {
  return `sha256:${createHash('sha256').update(secret).digest('hex')}`
}

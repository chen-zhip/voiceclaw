import { DesktopHostConnectionGateway } from './host-connection.js'
import { RemoteHostEnrollmentService, type EnrollmentPrincipal } from './host-enrollment.js'
import { ControlStateStore } from '../plugin-kernel/control-state-store.js'

export class HostManagementError extends Error {
  constructor(
    readonly code: 'owner_authorization_required' | 'host_not_found' | 'host_not_revoked',
    message: string
  ) {
    super(message)
    this.name = 'HostManagementError'
  }
}

export class HostManagementService {
  constructor(
    private readonly store: ControlStateStore,
    private readonly connections: DesktopHostConnectionGateway,
    private readonly enrollment: RemoteHostEnrollmentService,
    private readonly options: { authorizeOwner(principal: EnrollmentPrincipal): boolean }
  ) {}

  async inspect(principal: EnrollmentPrincipal) {
    this.#authorize(principal)
    const hosts = this.store.read().hosts
    const visibleHosts = hosts.some((host) => !host.revoked)
      ? hosts.filter((host) => !host.revoked)
      : hosts
    return visibleHosts.map((host) => ({
      hostId: host.id,
      status: host.revoked
        ? ('revoked' as const)
        : this.connections.isConnected(host.id)
          ? ('online' as const)
          : ('offline' as const),
      lastActivityAt: host.lastActivityAt ?? null,
    }))
  }

  async revoke(principal: EnrollmentPrincipal, hostId: string): Promise<void> {
    this.#authorize(principal)
    if (!this.store.read().hosts.some((host) => host.id === hostId)) {
      throw new HostManagementError('host_not_found', 'Desktop Host is not registered')
    }
    await this.store.commit((state) => ({
      ...state,
      hosts: state.hosts.map((host) => (host.id === hostId ? { ...host, revoked: true } : host)),
    }))
    this.connections.disconnect(hostId)
  }

  async requestReregistration(principal: EnrollmentPrincipal, installationId: string) {
    this.#authorize(principal)
    const current = this.store.read().hosts.find((host) => host.installationId === installationId)
    if (current && !current.revoked) {
      throw new HostManagementError(
        'host_not_revoked',
        'Active Desktop Host must be revoked before re-registration'
      )
    }
    return this.enrollment.issueToken({ principal, installationId })
  }

  #authorize(principal: EnrollmentPrincipal): void {
    if (!this.options.authorizeOwner(principal)) {
      throw new HostManagementError(
        'owner_authorization_required',
        'Only the authenticated owner can manage Desktop Hosts'
      )
    }
  }
}

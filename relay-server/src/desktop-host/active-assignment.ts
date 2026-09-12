import { DesktopHostConnectionGateway } from './host-connection.js'
import { ControlStateStore } from '../plugin-kernel/control-state-store.js'

type Principal = {
  kind: 'relay-authority' | 'desktop-host'
  id: string
}

type ReadinessReport = {
  bindingId: string
  providerId: string
  workspaceBindingId: string
  ready: boolean
}

export class ActiveHostAssignmentError extends Error {
  constructor(
    readonly code:
      | 'relay_authority_required'
      | 'host_principal_required'
      | 'host_unavailable'
      | 'assignment_not_found',
    message: string
  ) {
    super(message)
    this.name = 'ActiveHostAssignmentError'
  }
}

export class ActiveHostAssignmentService {
  #readiness: Array<{ hostId: string; report: ReadinessReport }> = []

  constructor(
    private readonly store: ControlStateStore,
    private readonly connections: DesktopHostConnectionGateway
  ) {}

  async reportReadiness(principal: Principal, report: ReadinessReport): Promise<void> {
    if (principal.kind !== 'desktop-host' || !this.connections.isConnected(principal.id)) {
      throw new ActiveHostAssignmentError(
        'host_principal_required',
        'An authenticated Desktop Host must report readiness'
      )
    }
    this.#readiness = [
      ...this.#readiness.filter((candidate) => !sameReadiness(candidate, principal.id, report)),
      { hostId: principal.id, report: structuredClone(report) },
    ]
  }

  async select(
    principal: Principal,
    input: {
      bindingId: string
      hostId: string
      providerId: string
      workspaceBindingId: string
    }
  ) {
    this.#requireRelay(principal)
    const host = this.store
      .read()
      .hosts.find((candidate) => candidate.id === input.hostId && !candidate.revoked)
    const authorizedHost =
      host !== undefined || this.connections.isLocallyAuthenticated(input.hostId)
    const ready =
      this.#readiness.find((candidate) => sameReadiness(candidate, input.hostId, input))?.report
        .ready === true
    if (!authorizedHost || !this.connections.isConnected(input.hostId) || !ready) {
      throw new ActiveHostAssignmentError(
        'host_unavailable',
        'Desktop Host is not ready for the Logical Provider Binding'
      )
    }
    const previous = this.store
      .read()
      .assignments.find((assignment) => assignment.bindingId === input.bindingId)
    const assignment = {
      bindingId: input.bindingId,
      hostId: input.hostId,
      providerId: input.providerId,
      workspaceBindingId: input.workspaceBindingId,
      generation: (previous?.generation ?? 0) + 1,
    }
    await this.store.commit((state) => ({
      ...state,
      assignments: [
        ...state.assignments.filter((candidate) => candidate.bindingId !== input.bindingId),
        assignment,
      ],
    }))
    return { ...assignment, status: 'ready' as const }
  }

  async authoritativeReconnect(principal: Principal, hostPrincipal: Principal): Promise<number> {
    this.#requireRelay(principal)
    if (hostPrincipal.kind !== 'desktop-host' || !this.connections.isConnected(hostPrincipal.id)) {
      throw new ActiveHostAssignmentError(
        'host_principal_required',
        'Reconnect requires an authenticated Desktop Host Principal'
      )
    }
    const matching = this.store
      .read()
      .assignments.filter((assignment) => assignment.hostId === hostPrincipal.id)
    if (matching.length === 0) {
      throw new ActiveHostAssignmentError(
        'assignment_not_found',
        'Desktop Host has no Active Host Assignment'
      )
    }
    await this.store.commit((state) => ({
      ...state,
      assignments: state.assignments.map((assignment) =>
        assignment.hostId === hostPrincipal.id
          ? { ...assignment, generation: assignment.generation + 1 }
          : assignment
      ),
    }))
    return Math.max(
      ...this.store
        .read()
        .assignments.filter((assignment) => assignment.hostId === hostPrincipal.id)
        .map((assignment) => assignment.generation)
    )
  }

  hostDisconnected(principal: Principal): void {
    if (principal.kind !== 'desktop-host') {
      throw new ActiveHostAssignmentError(
        'host_principal_required',
        'Disconnect requires a Desktop Host Principal'
      )
    }
    this.connections.disconnect(principal.id)
    this.#readiness = this.#readiness.filter((candidate) => candidate.hostId !== principal.id)
  }

  inspect(bindingId: string) {
    const assignment = this.store
      .read()
      .assignments.find((candidate) => candidate.bindingId === bindingId)
    if (!assignment) {
      throw new ActiveHostAssignmentError(
        'assignment_not_found',
        'Active Host Assignment does not exist'
      )
    }
    const connected = this.connections.isConnected(assignment.hostId)
    const ready =
      assignment.providerId !== undefined &&
      assignment.workspaceBindingId !== undefined &&
      this.#readiness.find((candidate) => sameReadiness(candidate, assignment.hostId, assignment))
        ?.report.ready === true
    return {
      ...assignment,
      status: connected
        ? ready
          ? ('ready' as const)
          : ('unready' as const)
        : ('offline' as const),
    }
  }

  find(input: { hostId: string; providerId: string; workspaceBindingId: string }) {
    const assignment = this.store
      .read()
      .assignments.find(
        (candidate) =>
          candidate.hostId === input.hostId &&
          candidate.providerId === input.providerId &&
          candidate.workspaceBindingId === input.workspaceBindingId
      )
    return assignment ? this.inspect(assignment.bindingId) : undefined
  }

  #requireRelay(principal: Principal): void {
    if (principal.kind !== 'relay-authority') {
      throw new ActiveHostAssignmentError(
        'relay_authority_required',
        'Relay authority owns Active Host Assignment changes'
      )
    }
  }
}

function sameReadiness(
  candidate: { hostId: string; report: ReadinessReport },
  hostId: string,
  tuple: { bindingId: string; providerId: string; workspaceBindingId: string }
): boolean {
  return (
    candidate.hostId === hostId &&
    candidate.report.bindingId === tuple.bindingId &&
    candidate.report.providerId === tuple.providerId &&
    candidate.report.workspaceBindingId === tuple.workspaceBindingId
  )
}

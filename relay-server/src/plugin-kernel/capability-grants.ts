import { ControlStateStore } from './control-state-store.js'

export interface CapabilityAuthorizationRequest {
  principalId: string
  contractId: string
  operation: string
  scope: { kind: string; id?: string }
  secretRef?: string
  workspaceBindingId?: string
  requestedPermissions?: unknown
}

export interface CapabilityAuditEvent {
  principalId: string
  contractId: string
  operation: string
  scopeKind: string
  decision: 'allowed' | 'denied'
  reason: string
}

export class CapabilityGrantEvaluator {
  readonly #store: ControlStateStore
  readonly #audit: CapabilityAuditEvent[] = []

  constructor(store: ControlStateStore) {
    this.#store = store
  }

  authorize(
    request: CapabilityAuthorizationRequest
  ): { authorized: true; grantId: string } | { authorized: false; reason: string } {
    const grant = this.#store
      .read()
      .grants.find(
        (candidate) =>
          !candidate.revoked &&
          candidate.principalId === request.principalId &&
          candidate.contractId === request.contractId &&
          candidate.operation === request.operation &&
          sameScope(candidate.scope, request.scope)
      )

    let reason = 'No current Capability Grant'
    if (grant && request.secretRef && !grant.secretRefs.includes(request.secretRef)) {
      reason = 'Secret reference is outside the Capability Grant'
    } else if (
      grant &&
      request.workspaceBindingId &&
      !grant.workspaceBindings.includes(request.workspaceBindingId)
    ) {
      reason = 'Workspace Binding is outside the Capability Grant'
    } else if (grant) {
      this.#record(request, 'allowed', 'Current Capability Grant matched')
      return { authorized: true, grantId: grant.id }
    }

    this.#record(request, 'denied', reason)
    return { authorized: false, reason }
  }

  async revoke(grantId: string): Promise<void> {
    await this.#store.commit((state) => ({
      ...state,
      grants: state.grants.map((grant) =>
        grant.id === grantId ? { ...grant, revoked: true } : grant
      ),
    }))
  }

  auditEvents(): CapabilityAuditEvent[] {
    return this.#audit.map((event) => ({ ...event }))
  }

  #record(
    request: CapabilityAuthorizationRequest,
    decision: 'allowed' | 'denied',
    reason: string
  ): void {
    this.#audit.push({
      principalId: request.principalId,
      contractId: request.contractId,
      operation: request.operation,
      scopeKind: request.scope.kind,
      decision,
      reason,
    })
  }
}

function sameScope(
  left: { kind: string; id?: string },
  right: { kind: string; id?: string }
): boolean {
  return left.kind === right.kind && left.id === right.id
}

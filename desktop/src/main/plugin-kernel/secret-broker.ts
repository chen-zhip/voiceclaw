import { contributionKey, type ContributionIdentity } from '@voiceclaw/contracts'

export interface SecretContributionRegistration extends ContributionIdentity {
  declaredSecretRefs: string[]
  grantedSecretRefs: string[]
  operations: Record<string, (secret: string, payload: unknown) => Promise<unknown>>
}

export interface SecretInvocationRequest extends ContributionIdentity {
  secretRef: string
  operation: string
  payload: unknown
}

export class SecretBrokerError extends Error {
  constructor(
    readonly code: 'secret_access_denied' | 'secret_unavailable' | 'secret_exfiltration',
    message: string
  ) {
    super(message)
    this.name = 'SecretBrokerError'
  }
}

export class DesktopSecretBroker {
  readonly #resolveSecret: (reference: string) => Promise<string | undefined>
  readonly #audit: (event: Record<string, unknown>) => void
  readonly #contributions: Map<string, SecretContributionRegistration>

  constructor(options: {
    resolveSecret(reference: string): Promise<string | undefined>
    audit(event: Record<string, unknown>): void
    contributions: SecretContributionRegistration[]
  }) {
    this.#resolveSecret = options.resolveSecret
    this.#audit = options.audit
    this.#contributions = new Map(
      options.contributions.map((item) => [
        contributionKey(item.packageId, item.contributionId),
        item,
      ])
    )
  }

  async invoke(
    request: SecretInvocationRequest,
    context: {
      authenticatedCaller: {
        kind: 'desktop-contribution' | 'relay' | 'client'
        id: string
        packageId?: string
      }
    }
  ): Promise<unknown> {
    const contribution = this.#contributions.get(
      contributionKey(request.packageId, request.contributionId)
    )
    const operation = contribution?.operations[request.operation]
    if (
      context.authenticatedCaller.kind !== 'desktop-contribution' ||
      context.authenticatedCaller.packageId !== request.packageId ||
      context.authenticatedCaller.id !== request.contributionId ||
      !contribution ||
      !operation ||
      !contribution.declaredSecretRefs.includes(request.secretRef) ||
      !contribution.grantedSecretRefs.includes(request.secretRef)
    ) {
      this.#record(request, 'denied', 'Caller, operation, or Secret reference is unauthorized')
      throw new SecretBrokerError(
        'secret_access_denied',
        'Contribution is not authorized for the local Secret operation'
      )
    }

    const secret = await this.#resolveSecret(request.secretRef)
    if (secret === undefined) {
      this.#record(request, 'denied', 'Secret reference is unavailable')
      throw new SecretBrokerError('secret_unavailable', 'Declared Secret reference is unavailable')
    }

    const result = await operation(secret, structuredClone(request.payload))
    if (containsSecret(result, secret)) {
      this.#record(request, 'denied', 'Local operation attempted to return credential material')
      throw new SecretBrokerError(
        'secret_exfiltration',
        'Credential material cannot cross the Desktop broker boundary'
      )
    }
    this.#record(request, 'allowed', 'Secret was used locally')
    return result
  }

  async status(secretRef: string): Promise<{ configured: boolean; reference: string }> {
    return {
      configured: (await this.#resolveSecret(secretRef)) !== undefined,
      reference: secretRef,
    }
  }

  #record(request: SecretInvocationRequest, decision: 'allowed' | 'denied', reason: string): void {
    this.#audit({
      contributionId: request.contributionId,
      packageId: request.packageId,
      secretRef: request.secretRef,
      operation: request.operation,
      decision,
      reason,
    })
  }
}

function containsSecret(value: unknown, secret: string): boolean {
  if (typeof value === 'string') return value.includes(secret)
  if (Array.isArray(value)) return value.some((item) => containsSecret(item, secret))
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some((item) => containsSecret(item, secret))
  }
  return false
}

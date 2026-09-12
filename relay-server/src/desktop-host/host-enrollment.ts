import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  ControlStateStore,
  type HostRegistrationRecord,
} from '../plugin-kernel/control-state-store.js'

export type EnrollmentPrincipal = {
  kind: 'user' | 'client'
  id: string
}

export class HostEnrollmentError extends Error {
  constructor(
    readonly code:
      | 'owner_authorization_required'
      | 'invalid_enrollment_token'
      | 'host_limit_reached',
    message: string
  ) {
    super(message)
    this.name = 'HostEnrollmentError'
  }
}

export class RemoteHostEnrollmentService {
  readonly #pending = new Map<
    string,
    { installationId: string; hostId: string; expiresAt: number }
  >()

  constructor(
    private readonly store: ControlStateStore,
    private readonly options: {
      now?: () => number
      createSecret?: () => string
      createHostId?: () => string
      authorizeOwner(principal: EnrollmentPrincipal): boolean
      enrollmentTtlMs?: number
      credentialTtlMs?: number
    }
  ) {}

  async issueToken(input: { principal: EnrollmentPrincipal; installationId: string }) {
    if (!this.options.authorizeOwner(input.principal)) {
      throw new HostEnrollmentError(
        'owner_authorization_required',
        'Only the authenticated owner can enroll a Desktop Host'
      )
    }
    if (input.installationId.length === 0) {
      throw new HostEnrollmentError('invalid_enrollment_token', 'Installation identity is required')
    }
    const token = (this.options.createSecret ?? createSecret)()
    const now = (this.options.now ?? Date.now)()
    const expiresAt = now + (this.options.enrollmentTtlMs ?? 5 * 60_000)
    this.#pending.set(verifier(token), {
      installationId: input.installationId,
      hostId: (this.options.createHostId ?? randomUUID)(),
      expiresAt,
    })
    return { token, expiresAt: new Date(expiresAt).toISOString() }
  }

  async exchangeToken(input: { token: string }) {
    const enrollmentTokenVerifier = verifier(input.token)
    const pending = this.#pending.get(enrollmentTokenVerifier)
    const now = (this.options.now ?? Date.now)()
    const consumed = this.store
      .read()
      .hosts.some((host) => host.enrollmentTokenVerifier === enrollmentTokenVerifier)
    if (!pending || pending.expiresAt < now || consumed) {
      this.#pending.delete(enrollmentTokenVerifier)
      throw new HostEnrollmentError(
        'invalid_enrollment_token',
        'Enrollment token is expired, consumed, or invalid'
      )
    }
    let credential = ''
    let record: HostRegistrationRecord | undefined
    await this.store.commit((state) => ({
      ...state,
      hosts: (() => {
        if (state.hosts.some((host) => !host.revoked)) {
          throw new HostEnrollmentError(
            'host_limit_reached',
            'Phase 0 permits only one active Desktop Host registration'
          )
        }
        credential = (this.options.createSecret ?? createSecret)()
        const newRecord: HostRegistrationRecord = {
          id: pending.hostId,
          installationId: pending.installationId,
          credentialVerifier: verifier(credential),
          credentialExpiresAt:
            this.options.credentialTtlMs === undefined
              ? null
              : new Date(now + this.options.credentialTtlMs).toISOString(),
          enrollmentTokenVerifier,
          enrolledAt: new Date(now).toISOString(),
          lastActivityAt: null,
          authorityVersion: 1,
          revoked: false,
        }
        record = newRecord
        return [...state.hosts.filter((host) => host.id !== newRecord.id), newRecord]
      })(),
    }))
    this.#pending.delete(enrollmentTokenVerifier)
    return { hostId: pending.hostId, credential }
  }
}

export function verifySecret(secret: string, expectedVerifier: string): boolean {
  const actual = Buffer.from(verifier(secret))
  const expected = Buffer.from(expectedVerifier)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function verifier(secret: string): string {
  return `sha256:${createHash('sha256').update(secret).digest('hex')}`
}

function createSecret(): string {
  return randomBytes(32).toString('base64url')
}

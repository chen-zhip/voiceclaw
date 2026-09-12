import { open, readFile, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, relative, resolve } from 'node:path'
import { immutableCopy } from './immutable.js'
import { hasExactKeys, isNonemptyString, isRecord } from '@voiceclaw/contracts'

export interface CapabilityGrantRecord {
  id: string
  principalId: string
  contractId: string
  operation: string
  scope: { kind: string; id?: string }
  secretRefs: string[]
  workspaceBindings: string[]
  revoked: boolean
}

export interface LegacyHostRegistrationRecord {
  id: string
  installationId?: never
  credentialVerifier?: never
  credentialExpiresAt?: never
  enrollmentTokenVerifier?: never
  enrolledAt?: never
  lastActivityAt?: never
  authorityVersion?: never
  revoked: boolean
}

export interface EnrolledHostRegistrationRecord {
  id: string
  installationId: string
  credentialVerifier: string
  credentialExpiresAt: string | null
  enrollmentTokenVerifier: string
  enrolledAt: string
  lastActivityAt: string | null
  authorityVersion: number
  revoked: boolean
}

export type HostRegistrationRecord = LegacyHostRegistrationRecord | EnrolledHostRegistrationRecord

export interface LegacyActiveHostAssignmentRecord {
  bindingId: string
  hostId: string
  generation: number
  providerId?: never
  workspaceBindingId?: never
}

export interface ExactActiveHostAssignmentRecord {
  bindingId: string
  hostId: string
  providerId: string
  workspaceBindingId: string
  generation: number
}

export type ActiveHostAssignmentRecord =
  | LegacyActiveHostAssignmentRecord
  | ExactActiveHostAssignmentRecord

export interface ConversationThreadMappingRecord {
  conversationId: string
  providerId: string
  workspaceBindingId: string
  threadId: string
}

export interface ControlStateDocument {
  revision: number
  grants: CapabilityGrantRecord[]
  hosts: HostRegistrationRecord[]
  assignments: ActiveHostAssignmentRecord[]
  threadMappings: ConversationThreadMappingRecord[]
}

export interface ControlStateStoreOptions {
  requester: {
    kind: 'relay-authority' | 'plugin'
    id: string
  }
  atomicReplace?: (temporaryPath: string, targetPath: string) => Promise<void>
  allowedDirectory?: string
}

export class ControlStateError extends Error {
  constructor(
    readonly code: 'stale_revision' | 'invalid_control_state' | 'control_state_access_denied',
    message: string
  ) {
    super(message)
    this.name = 'ControlStateError'
  }
}

export class ControlStateStore {
  readonly #path: string
  readonly #atomicReplace: (temporaryPath: string, targetPath: string) => Promise<void>
  #state: ControlStateDocument
  #queue: Promise<void> = Promise.resolve()

  private constructor(
    path: string,
    state: ControlStateDocument,
    options: ControlStateStoreOptions
  ) {
    this.#path = resolve(path)
    this.#state = immutableCopy(state)
    this.#atomicReplace = options.atomicReplace ?? rename
  }

  static async open(path: string, options: ControlStateStoreOptions): Promise<ControlStateStore> {
    if (options?.requester?.kind !== 'relay-authority') {
      throw new ControlStateError(
        'control_state_access_denied',
        'Plugins cannot access Relay Control State'
      )
    }
    if (options.allowedDirectory) {
      const allowedDirectory = resolve(options.allowedDirectory)
      const target = resolve(path)
      const targetRelative = relative(allowedDirectory, target)
      if (
        targetRelative === '' ||
        targetRelative.startsWith('..') ||
        resolve(allowedDirectory, targetRelative) !== target
      ) {
        throw new ControlStateError(
          'invalid_control_state',
          'Relay Control State path is outside its configured directory'
        )
      }
    }
    let state = emptyControlState()
    try {
      const input: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (!isControlStateDocument(input)) {
        throw new ControlStateError(
          'invalid_control_state',
          'Stored Relay Control State is invalid'
        )
      }
      state = input
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return new ControlStateStore(path, state, options)
  }

  read(): Readonly<ControlStateDocument> {
    return this.#state
  }

  commit(
    mutate: (state: Readonly<ControlStateDocument>) => Record<string, unknown>,
    options: { expectedRevision?: number } = {}
  ): Promise<Readonly<ControlStateDocument>> {
    const operation = async () => {
      if (
        options.expectedRevision !== undefined &&
        options.expectedRevision !== this.#state.revision
      ) {
        throw new ControlStateError('stale_revision', 'Relay Control State revision is stale')
      }

      const proposed = mutate(structuredClone(this.#state))
      const candidate = { ...proposed, revision: this.#state.revision + 1 }
      if (!isControlStateDocument(candidate)) {
        throw new ControlStateError(
          'invalid_control_state',
          'Relay Control State update is invalid'
        )
      }

      await this.#write(candidate)
      this.#state = immutableCopy(candidate)
      return this.#state
    }

    const result = this.#queue.then(operation, operation)
    this.#queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  async #write(candidate: ControlStateDocument): Promise<void> {
    const temporaryPath = resolve(dirname(this.#path), `.${randomUUID()}.control-state.tmp`)
    let handle
    try {
      handle = await open(temporaryPath, 'wx')
      await handle.writeFile(`${JSON.stringify(candidate)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      await this.#atomicReplace(temporaryPath, this.#path)
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }
}

function emptyControlState(): ControlStateDocument {
  return {
    revision: 0,
    grants: [],
    hosts: [],
    assignments: [],
    threadMappings: [],
  }
}

function isControlStateDocument(value: unknown): value is ControlStateDocument {
  if (!isExactRecord(value, ['revision', 'grants', 'hosts', 'assignments', 'threadMappings']))
    return false
  return (
    Number.isSafeInteger(value.revision) &&
    (value.revision as number) >= 0 &&
    Array.isArray(value.grants) &&
    value.grants.every(isCapabilityGrant) &&
    Array.isArray(value.hosts) &&
    value.hosts.every(isHostRegistration) &&
    Array.isArray(value.assignments) &&
    value.assignments.every(isActiveHostAssignment) &&
    Array.isArray(value.threadMappings) &&
    value.threadMappings.every(isConversationThreadMapping)
  )
}

function isCapabilityGrant(value: unknown): value is CapabilityGrantRecord {
  if (
    !isExactRecord(value, [
      'id',
      'principalId',
      'contractId',
      'operation',
      'scope',
      'secretRefs',
      'workspaceBindings',
      'revoked',
    ])
  )
    return false
  if (!isRecord(value.scope)) return false
  return (
    isNonemptyString(value.id) &&
    isNonemptyString(value.principalId) &&
    isNonemptyString(value.contractId) &&
    isNonemptyString(value.operation) &&
    isExactRecord(value.scope, value.scope.id === undefined ? ['kind'] : ['kind', 'id']) &&
    isNonemptyString(value.scope.kind) &&
    (value.scope.id === undefined || isNonemptyString(value.scope.id)) &&
    isStringArray(value.secretRefs) &&
    isStringArray(value.workspaceBindings) &&
    typeof value.revoked === 'boolean'
  )
}

function isHostRegistration(value: unknown): value is HostRegistrationRecord {
  if (!isRecord(value) || !isNonemptyString(value.id) || typeof value.revoked !== 'boolean') {
    return false
  }
  if (hasExactKeys(value, ['id', 'revoked'])) return true
  return (
    hasExactKeys(value, [
      'id',
      'installationId',
      'credentialVerifier',
      'credentialExpiresAt',
      'enrollmentTokenVerifier',
      'enrolledAt',
      'lastActivityAt',
      'authorityVersion',
      'revoked',
    ]) &&
    isNonemptyString(value.installationId) &&
    isVerifier(value.credentialVerifier) &&
    (value.credentialExpiresAt === null || isIsoDate(value.credentialExpiresAt)) &&
    isVerifier(value.enrollmentTokenVerifier) &&
    isIsoDate(value.enrolledAt) &&
    (value.lastActivityAt === null || isIsoDate(value.lastActivityAt)) &&
    Number.isSafeInteger(value.authorityVersion) &&
    (value.authorityVersion as number) >= 1
  )
}

function isActiveHostAssignment(value: unknown): value is ActiveHostAssignmentRecord {
  if (!isRecord(value)) return false
  const exactKeys =
    hasExactKeys(value, ['bindingId', 'hostId', 'generation']) ||
    hasExactKeys(value, ['bindingId', 'hostId', 'providerId', 'workspaceBindingId', 'generation'])
  return (
    exactKeys &&
    isNonemptyString(value.bindingId) &&
    isNonemptyString(value.hostId) &&
    (value.providerId === undefined || isNonemptyString(value.providerId)) &&
    (value.workspaceBindingId === undefined || isNonemptyString(value.workspaceBindingId)) &&
    Number.isSafeInteger(value.generation) &&
    (value.generation as number) >= 0
  )
}

function isConversationThreadMapping(value: unknown): value is ConversationThreadMappingRecord {
  return (
    isExactRecord(value, ['conversationId', 'providerId', 'workspaceBindingId', 'threadId']) &&
    isNonemptyString(value.conversationId) &&
    isNonemptyString(value.providerId) &&
    isNonemptyString(value.workspaceBindingId) &&
    isNonemptyString(value.threadId)
  )
}

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonemptyString)
}

function isVerifier(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

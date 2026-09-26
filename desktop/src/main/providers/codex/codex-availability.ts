import { hasExactKeys, isNonemptyString, isRecord } from '@voiceclaw/contracts'
import { codexPluginManifest, CODEX_PROVIDER_CONTRIBUTION_ID } from './codex-package.js'
import { selectCodexCapabilityProfile, type CodexProfileWarning } from './codex-profile.js'

export interface CodexNativeConfiguration {
  bindingId: string
  workspaceBindingId: string
  workspacePath: string
  executablePath: string
  preferences: Record<string, string | boolean>
  secretRefs: Record<string, string>
}

export interface CodexRuntimeState {
  process: 'starting' | 'running' | 'stopped' | 'failed'
  transport: 'disconnected' | 'ready'
  session: 'unavailable' | 'ready'
}

export interface CodexReadiness extends CodexRuntimeState {
  contribution: 'ACTIVE' | 'DEGRADED'
  executable: 'detected' | 'missing'
}

export interface CodexAvailabilityDescriptor {
  configuration: {
    bindingId: string
    workspaceBindingId: string
    workspacePath: string
    executablePath: string
    preferences: Record<string, string | boolean>
    secretReferences: string[]
  }
  readiness: CodexReadiness
  profile: {
    status: 'exact' | 'unverified'
    profileVersion: string
    capabilityProfileVersion: string
    warning: CodexProfileWarning | null
  }
  canDispatch: boolean
  guidance: string[]
}

export interface CodexAvailabilityProjection {
  providerId: 'codex'
  bindingId: string
  workspaceBindingId: string
  capabilityProfileVersion: string
  profileStatus: 'exact' | 'unverified'
  readiness: CodexReadiness
  warnings: CodexProfileWarning[]
}

export class CodexAvailabilityError extends Error {
  constructor(
    readonly code: 'invalid_codex_configuration',
    message: string
  ) {
    super(message)
    this.name = 'CodexAvailabilityError'
  }
}

type PreferenceRule = { type: 'string' | 'boolean'; enum?: string[] }

const configurationSchema = (() => {
  const provider = codexPluginManifest.contributions.find(
    (contribution) => contribution.id === CODEX_PROVIDER_CONTRIBUTION_ID
  )
  const schema = provider?.configSchema as
    | {
        required?: string[]
        properties?: Record<string, { type?: string; enum?: string[] }>
      }
    | undefined
  return {
    required: schema?.required ?? [],
    properties: Object.fromEntries(
      Object.entries(schema?.properties ?? {}).map(([key, rule]) => [
        key,
        {
          type: rule.type === 'boolean' ? 'boolean' : 'string',
          ...(rule.enum ? { enum: rule.enum } : {}),
        } as PreferenceRule,
      ])
    ),
  }
})()

export class CodexAvailabilityService {
  constructor(private readonly boundary: { detectExecutable(path: string): Promise<boolean> }) {}

  async describe(input: {
    configuration: unknown
    runtime: CodexRuntimeState
    detectedVersion: string
  }): Promise<CodexAvailabilityDescriptor> {
    const configuration = parseCodexNativeConfiguration(input.configuration)
    const selection = selectCodexCapabilityProfile(input.detectedVersion)
    const executable = (await this.boundary.detectExecutable(configuration.executablePath))
      ? 'detected'
      : 'missing'
    const readiness: CodexReadiness = {
      contribution: executable === 'missing' ? 'DEGRADED' : 'ACTIVE',
      executable,
      process: input.runtime.process,
      transport: input.runtime.transport,
      session: input.runtime.session,
    }

    return {
      configuration: {
        bindingId: configuration.bindingId,
        workspaceBindingId: configuration.workspaceBindingId,
        workspacePath: configuration.workspacePath,
        executablePath: configuration.executablePath,
        preferences: { ...configuration.preferences },
        secretReferences: Object.keys(configuration.secretRefs).sort(),
      },
      readiness,
      profile: {
        status: selection.status,
        profileVersion: selection.profile.version,
        capabilityProfileVersion: selection.profile.capabilityContract.version,
        warning: selection.warning,
      },
      canDispatch:
        readiness.executable === 'detected' &&
        readiness.process === 'running' &&
        readiness.transport === 'ready' &&
        readiness.session === 'ready',
      guidance: availabilityGuidance(readiness),
    }
  }
}

export function projectCodexAvailability(
  descriptor: CodexAvailabilityDescriptor
): CodexAvailabilityProjection {
  return {
    providerId: 'codex',
    bindingId: descriptor.configuration.bindingId,
    workspaceBindingId: descriptor.configuration.workspaceBindingId,
    capabilityProfileVersion: descriptor.profile.capabilityProfileVersion,
    profileStatus: descriptor.profile.status,
    readiness: { ...descriptor.readiness },
    warnings: descriptor.profile.warning ? [{ ...descriptor.profile.warning }] : [],
  }
}

export function parseCodexNativeConfiguration(input: unknown): CodexNativeConfiguration {
  if (!isRecord(input)) {
    throw invalidConfiguration()
  }
  const allowed = [
    'bindingId',
    'workspaceBindingId',
    'workspacePath',
    'executablePath',
    'preferences',
    'secretRefs',
  ]
  if (!hasExactKeys({ ...input, ...emptyDefaults(input) }, allowed)) throw invalidConfiguration()
  if (!isNonemptyString(input.bindingId) || !isNonemptyString(input.workspaceBindingId)) {
    throw invalidConfiguration()
  }
  if (!isNonemptyString(input.workspacePath)) throw invalidConfiguration()
  const executablePath =
    input.executablePath === undefined
      ? 'codex'
      : isNonemptyString(input.executablePath)
        ? input.executablePath
        : undefined
  if (!executablePath) throw invalidConfiguration()

  const preferences = parsePreferences(input.preferences)
  const secretRefs = parseSecretRefs(input.secretRefs)
  return {
    bindingId: input.bindingId,
    workspaceBindingId: input.workspaceBindingId,
    workspacePath: input.workspacePath,
    executablePath,
    preferences,
    secretRefs,
  }
}

function parsePreferences(value: unknown): Record<string, string | boolean> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw invalidConfiguration()
  const preferences: Record<string, string | boolean> = {}
  for (const [key, preference] of Object.entries(value)) {
    const rule = configurationSchema.properties[key]
    if (!rule) throw invalidConfiguration()
    if (rule.type === 'boolean') {
      if (typeof preference !== 'boolean') throw invalidConfiguration()
      preferences[key] = preference
      continue
    }
    if (typeof preference !== 'string') throw invalidConfiguration()
    if (rule.enum && !rule.enum.includes(preference)) throw invalidConfiguration()
    preferences[key] = preference
  }
  return preferences
}

function parseSecretRefs(value: unknown): Record<string, string> {
  if (value === undefined) return {}
  if (!isRecord(value) || !Object.values(value).every(isNonemptyString)) {
    throw invalidConfiguration()
  }
  return { ...(value as Record<string, string>) }
}

function emptyDefaults(input: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(input.executablePath === undefined ? { executablePath: 'codex' } : {}),
    ...(input.preferences === undefined ? { preferences: {} } : {}),
    ...(input.secretRefs === undefined ? { secretRefs: {} } : {}),
  }
}

function availabilityGuidance(readiness: CodexReadiness): string[] {
  if (readiness.executable === 'missing') {
    return ['Set the Codex executable path to an installed codex-cli 0.153.4 binary.']
  }
  if (readiness.process !== 'running' || readiness.transport !== 'ready') {
    return ['Start or repair the Codex app-server process for this Active Host.']
  }
  if (readiness.session !== 'ready') {
    return ['Authenticate Codex locally; VoiceClaw never receives Codex credential material.']
  }
  return []
}

function invalidConfiguration(): CodexAvailabilityError {
  return new CodexAvailabilityError(
    'invalid_codex_configuration',
    'Native Codex configuration does not match the package Configuration Schema'
  )
}

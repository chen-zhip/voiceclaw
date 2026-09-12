import { hasExactKeys, isNonemptyString, isRecord } from '@voiceclaw/contracts'

export interface NativeProviderConfiguration {
  providerId: string
  bindingId: string
  workspaceBindingId: string
  workspacePath: string
  executable: { path: string; args: string[] }
  preferences: Record<string, unknown>
  secretRefs: Record<string, string>
}

export interface DesktopSettingsDatabase {
  prepare(sql: string): {
    get(key: string): unknown
    run(key: string, value: string): unknown
  }
}

export class DesktopSettingsStorage {
  constructor(private readonly database: DesktopSettingsDatabase) {}

  async get(key: string): Promise<string | undefined> {
    const row = this.database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value?: unknown }
      | undefined
    return typeof row?.value === 'string' ? row.value : undefined
  }

  async set(key: string, value: string): Promise<void> {
    this.database
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(key, value)
  }
}

type PreferenceRule = { type: 'string' } | { type: 'boolean' } | { type: 'enum'; values: string[] }

type ReadinessField =
  | 'providerId'
  | 'bindingId'
  | 'workspaceBindingId'
  | 'configured'
  | 'executableDetected'

type ReadinessInput = {
  configured: boolean
  executableDetected: boolean
  [key: string]: unknown
}

export class NativeProviderConfigurationError extends Error {
  constructor(
    readonly code: 'invalid_native_configuration' | 'native_configuration_not_found',
    message: string
  ) {
    super(message)
    this.name = 'NativeProviderConfigurationError'
  }
}

export class NativeProviderConfigurationService {
  constructor(
    private readonly storage: {
      get(key: string): Promise<string | undefined>
      set(key: string, value: string): Promise<void>
    },
    private readonly schema: {
      preferences: Record<string, PreferenceRule>
      readinessFields: ReadinessField[]
    }
  ) {}

  async save(configuration: NativeProviderConfiguration): Promise<void> {
    if (!this.#valid(configuration)) {
      throw new NativeProviderConfigurationError(
        'invalid_native_configuration',
        'Native Provider Configuration does not match its schema'
      )
    }
    await this.storage.set(storageKey(configuration.bindingId), JSON.stringify(configuration))
  }

  async load(bindingId: string): Promise<NativeProviderConfiguration> {
    const stored = await this.storage.get(storageKey(bindingId))
    if (!stored) {
      throw new NativeProviderConfigurationError(
        'native_configuration_not_found',
        'Native Provider Configuration does not exist'
      )
    }
    let configuration: unknown
    try {
      configuration = JSON.parse(stored)
    } catch {
      configuration = undefined
    }
    if (!this.#valid(configuration)) {
      throw new NativeProviderConfigurationError(
        'invalid_native_configuration',
        'Stored Native Provider Configuration is invalid'
      )
    }
    return structuredClone(configuration)
  }

  async projectReadiness(bindingId: string, readiness: ReadinessInput) {
    const configuration = await this.load(bindingId)
    const candidates: Record<ReadinessField, string | boolean> = {
      providerId: configuration.providerId,
      bindingId: configuration.bindingId,
      workspaceBindingId: configuration.workspaceBindingId,
      configured: readiness.configured,
      executableDetected: readiness.executableDetected,
    }
    return Object.fromEntries(
      this.schema.readinessFields.map((field) => [field, candidates[field]])
    ) as Partial<Record<ReadinessField, string | boolean>>
  }

  #valid(value: unknown): value is NativeProviderConfiguration {
    if (!isRecord(value) || !hasExactKeys(value, configurationKeys)) return false
    if (
      !isNonemptyString(value.providerId) ||
      !isNonemptyString(value.bindingId) ||
      !isNonemptyString(value.workspaceBindingId) ||
      !isNonemptyString(value.workspacePath) ||
      !isRecord(value.executable) ||
      !hasExactKeys(value.executable, ['path', 'args']) ||
      !isNonemptyString(value.executable.path) ||
      !Array.isArray(value.executable.args) ||
      !value.executable.args.every((argument) => typeof argument === 'string') ||
      !isRecord(value.preferences) ||
      !isRecord(value.secretRefs) ||
      !Object.values(value.secretRefs).every(isNonemptyString)
    ) {
      return false
    }
    return Object.entries(value.preferences).every(([key, preference]) => {
      const rule = this.schema.preferences[key]
      if (!rule) return false
      if (rule.type === 'string') return typeof preference === 'string'
      if (rule.type === 'boolean') return typeof preference === 'boolean'
      return typeof preference === 'string' && rule.values.includes(preference)
    })
  }
}

const configurationKeys = [
  'providerId',
  'bindingId',
  'workspaceBindingId',
  'workspacePath',
  'executable',
  'preferences',
  'secretRefs',
]

function storageKey(bindingId: string): string {
  return `desktop-host:native-provider-configuration:${bindingId}`
}

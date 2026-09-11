export const PHASE_ZERO_CONTRIBUTION_TYPES = [
  'desktop-service',
  'provider-integration',
  'client-ui',
] as const

export type PhaseZeroContributionType = (typeof PHASE_ZERO_CONTRIBUTION_TYPES)[number]

export interface ProvidedCapability {
  id: string
  version: string
}

export interface RequiredCapability {
  id: string
  range: string
}

export interface PluginContributionManifest {
  id: string
  type: PhaseZeroContributionType
  runtime: string
  entry: string
  provides: ProvidedCapability[]
  requires: RequiredCapability[]
  configSchema: Record<string, unknown>
  requestedPermissions: Array<Record<string, unknown>>
}

export interface PluginManifestV0 {
  manifestVersion: 0
  id: string
  version: string
  voiceclawVersionRange: string
  feature: {
    id: string
    displayName: string
  }
  contributions: PluginContributionManifest[]
  lifecycle: {
    activation: 'startup'
    disable: 'restart-required'
    update: 'restart-required'
    uninstall: 'unsupported'
    dataDisposition: 'retain'
  }
}

export interface ManifestValidationError {
  path: string
  code: string
  message: string
}

export type ManifestValidationResult =
  | { success: true; data: PluginManifestV0 }
  | { success: false; errors: ManifestValidationError[] }

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CAPABILITY_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const RANGE_PART_PATTERN = /^(?:[<>=~^]+)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function isVersionRange(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.length > 0 &&
    value.split(/\s+/).every((part) => RANGE_PART_PATTERN.test(part))
  )
}

function normalizeEntry(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\')) {
    return undefined
  }
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return undefined

  const parts: string[] = []
  for (const part of value.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return undefined
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return parts.length > 0 ? parts.join('/') : undefined
}

export function parsePluginManifest(input: unknown): ManifestValidationResult {
  const errors: ManifestValidationError[] = []
  const reject = (path: string, code: string, message: string) => {
    errors.push({ path, code, message })
  }

  if (!isRecord(input)) {
    return {
      success: false,
      errors: [{ path: '$', code: 'invalid_type', message: 'Manifest must be an object' }],
    }
  }

  const rootKeys = [
    'manifestVersion',
    'id',
    'version',
    'voiceclawVersionRange',
    'feature',
    'contributions',
    'lifecycle',
  ]
  if (!hasExactKeys(input, rootKeys)) {
    reject('$', 'invalid_fields', 'Manifest fields do not match version 0')
  }
  if (input.manifestVersion !== 0)
    reject('manifestVersion', 'unsupported_version', 'Only manifest version 0 is supported')
  if (typeof input.id !== 'string' || !ID_PATTERN.test(input.id))
    reject('id', 'invalid_id', 'Package ID must be lowercase kebab-case')
  if (typeof input.version !== 'string' || !SEMVER_PATTERN.test(input.version))
    reject('version', 'invalid_semver', 'Package version must be SemVer')
  if (!isVersionRange(input.voiceclawVersionRange))
    reject('voiceclawVersionRange', 'invalid_semver_range', 'VoiceClaw version range is invalid')

  if (!isRecord(input.feature) || !hasExactKeys(input.feature, ['id', 'displayName'])) {
    reject('feature', 'invalid_feature', 'Exactly one Feature definition is required')
  } else {
    if (typeof input.feature.id !== 'string' || !ID_PATTERN.test(input.feature.id))
      reject('feature.id', 'invalid_id', 'Feature ID must be lowercase kebab-case')
    if (
      typeof input.feature.displayName !== 'string' ||
      input.feature.displayName.trim().length === 0
    )
      reject('feature.displayName', 'invalid_display_name', 'Feature display name is required')
  }

  const normalizedContributions: PluginContributionManifest[] = []
  const contributionIds = new Set<string>()
  if (!Array.isArray(input.contributions) || input.contributions.length === 0) {
    reject('contributions', 'invalid_contributions', 'At least one Contribution is required')
  } else {
    input.contributions.forEach((value, index) => {
      const path = `contributions.${index}`
      const keys = [
        'id',
        'type',
        'runtime',
        'entry',
        'provides',
        'requires',
        'configSchema',
        'requestedPermissions',
      ]
      if (!isRecord(value) || !hasExactKeys(value, keys)) {
        reject(path, 'invalid_fields', 'Contribution fields do not match Manifest v0')
        return
      }
      if (typeof value.id !== 'string' || !ID_PATTERN.test(value.id))
        reject(`${path}.id`, 'invalid_id', 'Contribution ID must be lowercase kebab-case')
      else if (contributionIds.has(value.id))
        reject(`${path}.id`, 'duplicate_id', 'Contribution ID must be package-local unique')
      else contributionIds.add(value.id)

      if (!PHASE_ZERO_CONTRIBUTION_TYPES.includes(value.type as PhaseZeroContributionType))
        reject(`${path}.type`, 'unsupported_type', 'Contribution type is not supported in Phase 0')
      if (typeof value.runtime !== 'string' || value.runtime.trim().length === 0)
        reject(`${path}.runtime`, 'invalid_runtime', 'Contribution runtime is required')
      const entry = normalizeEntry(value.entry)
      if (!entry)
        reject(
          `${path}.entry`,
          'entry_outside_package',
          'Contribution entry must remain package-relative'
        )

      const provides = parseProvides(value.provides, `${path}.provides`, reject)
      const requires = parseRequires(value.requires, `${path}.requires`, reject)
      if (!isRecord(value.configSchema))
        reject(`${path}.configSchema`, 'invalid_schema', 'Configuration Schema must be an object')
      if (!Array.isArray(value.requestedPermissions) || !value.requestedPermissions.every(isRecord))
        reject(
          `${path}.requestedPermissions`,
          'invalid_permissions',
          'Requested permissions must be declarations'
        )

      if (
        entry &&
        provides &&
        requires &&
        isRecord(value.configSchema) &&
        Array.isArray(value.requestedPermissions) &&
        value.requestedPermissions.every(isRecord)
      ) {
        normalizedContributions.push({
          id: value.id as string,
          type: value.type as PhaseZeroContributionType,
          runtime: value.runtime as string,
          entry,
          provides,
          requires,
          configSchema: value.configSchema,
          requestedPermissions: value.requestedPermissions,
        })
      }
    })
  }

  const lifecycle = input.lifecycle
  if (
    !isRecord(lifecycle) ||
    !hasExactKeys(lifecycle, ['activation', 'disable', 'update', 'uninstall', 'dataDisposition']) ||
    lifecycle.activation !== 'startup' ||
    lifecycle.disable !== 'restart-required' ||
    lifecycle.update !== 'restart-required' ||
    lifecycle.uninstall !== 'unsupported' ||
    lifecycle.dataDisposition !== 'retain'
  ) {
    reject('lifecycle', 'unsupported_lifecycle', 'Manifest v0 has a fixed lifecycle')
  }

  if (errors.length > 0) return { success: false, errors }
  return {
    success: true,
    data: {
      manifestVersion: 0,
      id: input.id as string,
      version: input.version as string,
      voiceclawVersionRange: input.voiceclawVersionRange as string,
      feature: input.feature as PluginManifestV0['feature'],
      contributions: normalizedContributions,
      lifecycle: lifecycle as PluginManifestV0['lifecycle'],
    },
  }
}

function parseProvides(
  value: unknown,
  path: string,
  reject: (path: string, code: string, message: string) => void
): ProvidedCapability[] | undefined {
  if (!Array.isArray(value)) {
    reject(path, 'invalid_provides', 'Provided capabilities must be an array')
    return undefined
  }
  const result: ProvidedCapability[] = []
  value.forEach((item, index) => {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ['id', 'version']) ||
      typeof item.id !== 'string' ||
      !CAPABILITY_ID_PATTERN.test(item.id) ||
      typeof item.version !== 'string' ||
      !SEMVER_PATTERN.test(item.version)
    ) {
      reject(
        `${path}.${index}`,
        'invalid_capability',
        'Provided capability requires a valid ID and SemVer version'
      )
      return
    }
    result.push({ id: item.id, version: item.version })
  })
  return result
}

function parseRequires(
  value: unknown,
  path: string,
  reject: (path: string, code: string, message: string) => void
): RequiredCapability[] | undefined {
  if (!Array.isArray(value)) {
    reject(path, 'invalid_requires', 'Required capabilities must be an array')
    return undefined
  }
  const result: RequiredCapability[] = []
  value.forEach((item, index) => {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ['id', 'range']) ||
      typeof item.id !== 'string' ||
      !CAPABILITY_ID_PATTERN.test(item.id) ||
      !isVersionRange(item.range)
    ) {
      reject(
        `${path}.${index}`,
        'invalid_capability',
        'Required capability requires a valid ID and SemVer range'
      )
      return
    }
    result.push({ id: item.id, range: item.range })
  })
  return result
}
import { hasExactKeys, isRecord } from './validation.js'

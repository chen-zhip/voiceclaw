const VERSION_PATTERN = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/

export interface CodexCapabilityProfile {
  version: string
  capabilityContract: { id: 'harness.capability-profile'; version: string }
  executionContract: { id: 'harness.execution'; version: string }
  operations: Array<'provider.describe' | 'thread.ensure' | 'turn.start' | 'turn.cancel'>
  deferred: Array<'history-import' | 'native-tui-handoff' | 'approval-route' | 'advanced-recovery'>
  processDefiningSettings: string[]
}

export interface CodexProfileWarning {
  code: 'unverified-codex-version'
  detectedVersion: string
  profileVersion: string
  message: string
}

export type CodexProfileSelection = {
  status: 'exact' | 'unverified'
  profile: CodexCapabilityProfile
  warning: CodexProfileWarning | null
}

export class CodexCapabilityProfileError extends Error {
  constructor(
    readonly code: 'unsupported_codex_version',
    message: string
  ) {
    super(message)
    this.name = 'CodexCapabilityProfileError'
  }
}

const verifiedProfile: CodexCapabilityProfile = {
  version: '0.153.4',
  capabilityContract: { id: 'harness.capability-profile', version: '1.0.0' },
  executionContract: { id: 'harness.execution', version: '1.0.0' },
  operations: ['provider.describe', 'thread.ensure', 'turn.start', 'turn.cancel'],
  deferred: ['history-import', 'native-tui-handoff', 'approval-route', 'advanced-recovery'],
  processDefiningSettings: ['executablePath', 'accountRef', 'model', 'approvalPolicy'],
}

const knownProfiles: CodexCapabilityProfile[] = [verifiedProfile]

export function parseCodexVersion(detected: string): string | undefined {
  return VERSION_PATTERN.exec(detected)?.[1]
}

export function selectCodexCapabilityProfile(detectedVersion: string): CodexProfileSelection {
  const version = parseCodexVersion(detectedVersion)
  if (!version) {
    throw new CodexCapabilityProfileError(
      'unsupported_codex_version',
      'Detected Codex version is not a version number'
    )
  }
  const exact = knownProfiles.find((profile) => profile.version === version)
  if (exact) return { status: 'exact', profile: exact, warning: null }

  const nearest = nearestCompatibleProfile(version)
  if (!nearest) {
    throw new CodexCapabilityProfileError(
      'unsupported_codex_version',
      `No verified Codex Capability Profile is compatible with ${version}`
    )
  }
  return {
    status: 'unverified',
    profile: nearest,
    warning: {
      code: 'unverified-codex-version',
      detectedVersion: version,
      profileVersion: nearest.version,
      message: `Codex ${version} is not an exactly verified Capability Profile`,
    },
  }
}

function nearestCompatibleProfile(version: string): CodexCapabilityProfile | undefined {
  const line = version.split('.').slice(0, 2).join('.')
  const compatible = knownProfiles.filter((profile) => profile.version.startsWith(`${line}.`))
  if (compatible.length === 0) return undefined
  const patch = Number(version.split('.')[2])
  return compatible.sort(
    (left, right) =>
      Math.abs(Number(left.version.split('.')[2]) - patch) -
      Math.abs(Number(right.version.split('.')[2]) - patch)
  )[0]
}

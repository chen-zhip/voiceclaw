interface Version {
  major: number
  minor: number
  patch: number
  prerelease: Array<number | string>
}

export function versionSatisfies(version: string, range: string): boolean {
  const candidate = parseVersion(version)
  if (!candidate) return false
  const comparators = range.split(/\s+/)
  if (
    candidate.prerelease.length > 0 &&
    !comparators.some((comparator) => {
      const expected = parseVersion(comparator.replace(/^(?:<=|>=|<|>|=|\^|~)/, ''))
      return (
        expected !== undefined &&
        expected.prerelease.length > 0 &&
        expected.major === candidate.major &&
        expected.minor === candidate.minor &&
        expected.patch === candidate.patch
      )
    })
  ) {
    return false
  }
  return comparators.every((part) => satisfiesComparator(candidate, part))
}

function satisfiesComparator(candidate: Version, comparator: string): boolean {
  const match = /^(<=|>=|<|>|=|\^|~)?(.+)$/.exec(comparator)
  const expected = match ? parseVersion(match[2]) : undefined
  if (!match || !expected) return false
  const comparison = compareVersions(candidate, expected)
  switch (match[1] ?? '=') {
    case '>=':
      return comparison >= 0
    case '<=':
      return comparison <= 0
    case '>':
      return comparison > 0
    case '<':
      return comparison < 0
    case '^':
      return comparison >= 0 && compareVersions(candidate, caretUpperBound(expected)) < 0
    case '~':
      return (
        comparison >= 0 &&
        compareVersions(candidate, {
          major: expected.major,
          minor: expected.minor + 1,
          patch: 0,
          prerelease: [],
        }) < 0
      )
    default:
      return comparison === 0
  }
}

function caretUpperBound(version: Version): Version {
  if (version.major > 0) {
    return { major: version.major + 1, minor: 0, patch: 0, prerelease: [] }
  }
  if (version.minor > 0) {
    return { major: 0, minor: version.minor + 1, patch: 0, prerelease: [] }
  }
  return { major: 0, minor: 0, patch: version.patch + 1, prerelease: [] }
}

function parseVersion(value: string): Version | undefined {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      value
    )
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]
      ? match[4].split('.').map((part) => (/^(0|[1-9]\d*)$/.test(part) ? Number(part) : part))
      : [],
  }
}

function compareVersions(left: Version, right: Version): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] - right[key]
  }
  if (left.prerelease.length === 0) return right.prerelease.length === 0 ? 0 : 1
  if (right.prerelease.length === 0) return -1
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    if (typeof leftPart === 'number' && typeof rightPart === 'string') return -1
    if (typeof leftPart === 'string' && typeof rightPart === 'number') return 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}

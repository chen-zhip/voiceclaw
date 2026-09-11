export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

export function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, keys)
}

export function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

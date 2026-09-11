import { isRecord } from './validation.js'

export function isProviderNeutralValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(isProviderNeutralValue)
  if (!isRecord(value)) return true
  return Object.entries(value).every(
    ([key, child]) =>
      !/^(?:raw)?provider(?:method|event|payload|response)$/i.test(key) &&
      isProviderNeutralValue(child)
  )
}

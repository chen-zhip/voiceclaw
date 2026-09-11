export function immutableCopy<T>(value: T): Readonly<T> {
  return deepFreeze(structuredClone(value))
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

export interface ConfigurationValidationError {
  path: string
  code: string
  message: string
}

export type ConfigurationUpdateResult =
  | { success: true; value: Readonly<Record<string, unknown>> }
  | { success: false; errors: ConfigurationValidationError[] }

export class PluginConfigurationStore {
  readonly #schema: Record<string, unknown>
  #value: Readonly<Record<string, unknown>>

  constructor(schema: Record<string, unknown>, initial: Record<string, unknown>) {
    const errors = validateConfiguration(schema, initial)
    if (errors.length > 0) {
      throw new Error(
        `Invalid initial plugin configuration: ${errors.map((error) => `${error.path}:${error.code}`).join(',')}`
      )
    }
    this.#schema = structuredClone(schema)
    this.#value = immutableCopy(initial)
  }

  read(): Readonly<Record<string, unknown>> {
    return this.#value
  }

  update(value: unknown): ConfigurationUpdateResult {
    const errors = validateConfiguration(this.#schema, value)
    if (errors.length > 0) return { success: false, errors }
    this.#value = immutableCopy(value as Record<string, unknown>)
    return { success: true, value: this.#value }
  }
}

export function validateConfiguration(
  schema: Record<string, unknown>,
  value: unknown
): ConfigurationValidationError[] {
  const errors: ConfigurationValidationError[] = []
  validateNode(schema, value, '', errors)
  return errors
}

function validateNode(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  errors: ConfigurationValidationError[]
): void {
  const type = schema.type
  if (typeof type === 'string' && !matchesType(type, value)) {
    errors.push({ path: path || '$', code: 'type', message: `Expected ${type}` })
    return
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    errors.push({ path: path || '$', code: 'enum', message: 'Value is not an allowed option' })
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum)
      errors.push({ path: path || '$', code: 'minimum', message: 'Number is below the minimum' })
    if (typeof schema.maximum === 'number' && value > schema.maximum)
      errors.push({ path: path || '$', code: 'maximum', message: 'Number is above the maximum' })
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength)
      errors.push({
        path: path || '$',
        code: 'min_length',
        message: 'String is shorter than allowed',
      })
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength)
      errors.push({
        path: path || '$',
        code: 'max_length',
        message: 'String is longer than allowed',
      })
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern).test(value))
          errors.push({
            path: path || '$',
            code: 'pattern',
            message: 'String does not match the required pattern',
          })
      } catch {
        errors.push({
          path: path || '$',
          code: 'invalid_schema',
          message: 'Configuration Schema pattern is invalid',
        })
      }
    }
  }

  if (Array.isArray(value) && isRecord(schema.items)) {
    value.forEach((item, index) =>
      validateNode(
        schema.items as Record<string, unknown>,
        item,
        joinPath(path, String(index)),
        errors
      )
    )
  }

  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : []
    for (const key of required) {
      if (!(key in value))
        errors.push({
          path: joinPath(path, key),
          code: 'required',
          message: 'Required property is missing',
        })
    }
    for (const [key, child] of Object.entries(value)) {
      const childSchema = properties[key]
      if (isRecord(childSchema)) validateNode(childSchema, child, joinPath(path, key), errors)
      else if (schema.additionalProperties === false)
        errors.push({
          path: joinPath(path, key),
          code: 'additional_property',
          message: 'Property is not allowed',
        })
    }
  }
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'object':
      return isRecord(value)
    case 'array':
      return Array.isArray(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'string':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    default:
      return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function joinPath(parent: string, child: string): string {
  return parent ? `${parent}.${child}` : child
}

import { immutableCopy } from './immutable.js'

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Ajv from 'ajv'

export const CODEX_APP_SERVER_SCHEMA_VERSION = '0.153.4'
const PINNED_FINGERPRINT = '9d4323a9cbd22361d688490c42044ff1d8dbc1fd6085c557768c3d9166eb689e'

export interface CodexJsonSchema {
  title?: string
  type?: string
  required?: string[]
  properties?: Record<string, unknown>
  definitions?: Record<string, unknown>
}

export interface CodexAppServerSchemaArtifact {
  generator: { name: string; version: string }
  sha256: string
  shapes: Record<string, string[]>
  schemas: Record<string, CodexJsonSchema>
}

export type CodexAppServerSchemaValidation =
  | { valid: true; errors: [] }
  | { valid: false; errors: string[] }

export class CodexAppServerSchemaError extends Error {
  constructor(
    readonly code:
      | 'schema_artifact_missing'
      | 'schema_artifact_invalid'
      | 'schema_integrity_mismatch',
    message: string
  ) {
    super(message)
    this.name = 'CodexAppServerSchemaError'
  }
}

const REQUIRED_SHAPES: Record<string, Record<string, string[]>> = {
  initialize: {
    'v1/InitializeParams.json': ['clientInfo'],
    'v1/InitializeResponse.json': ['codexHome', 'platformFamily', 'platformOs', 'userAgent'],
  },
  thread: {
    'v2/ThreadStartParams.json': [],
    'v2/ThreadStartResponse.json': ['thread', 'cwd', 'model'],
    'v2/ThreadResumeParams.json': ['threadId'],
    'v2/ThreadResumeResponse.json': ['thread'],
  },
  turn: {
    'v2/TurnStartParams.json': ['threadId', 'input'],
    'v2/TurnStartResponse.json': ['turn'],
  },
  item: {
    'v2/ItemStartedNotification.json': ['item', 'threadId', 'turnId'],
    'v2/ItemCompletedNotification.json': ['item', 'threadId', 'turnId'],
    'v2/AgentMessageDeltaNotification.json': ['delta', 'itemId', 'threadId', 'turnId'],
  },
  interruption: {
    'v2/TurnInterruptParams.json': ['threadId', 'turnId'],
    'v2/TurnInterruptResponse.json': [],
  },
  terminal: {
    'v2/ThreadTokenUsageUpdatedNotification.json': ['threadId', 'turnId', 'tokenUsage'],
    'v2/TurnCompletedNotification.json': ['threadId', 'turn'],
    'v2/ErrorNotification.json': ['error', 'threadId', 'turnId', 'willRetry'],
  },
}

export function loadCodexAppServerSchema(directory: string): CodexAppServerSchemaArtifact {
  const metadata = readJson(join(directory, 'metadata.json'))
  if (!isMetadata(metadata)) {
    throw new CodexAppServerSchemaError(
      'schema_artifact_invalid',
      'Codex app-server schema metadata is invalid'
    )
  }

  const schemas: Record<string, CodexJsonSchema> = {}
  const digests: Array<{ path: string; sha256: string }> = []
  for (const file of metadata.files) {
    const bytes = readFileBytes(join(directory, ...file.path.split('/')))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (file.sha256 !== undefined && sha256 !== file.sha256) {
      throw new CodexAppServerSchemaError(
        'schema_integrity_mismatch',
        `Codex app-server schema ${file.path} does not match its recorded fingerprint`
      )
    }
    digests.push({ path: file.path, sha256 })
    schemas[file.path] = parseJson(bytes, file.path)
  }

  const sorted = [...digests].sort((left, right) => (left.path < right.path ? -1 : 1))
  const fingerprint = createHash('sha256')
    .update(sorted.map((entry) => `${entry.path}\n${entry.sha256}\n`).join(''))
    .digest('hex')
  if (metadata.sha256 !== fingerprint) {
    throw new CodexAppServerSchemaError(
      'schema_integrity_mismatch',
      'Codex app-server schema bundle does not match its recorded fingerprint'
    )
  }

  return {
    generator: { ...metadata.generator },
    sha256: fingerprint,
    shapes: Object.fromEntries(
      Object.entries(metadata.shapes).map(([shape, paths]) => [shape, [...paths]])
    ),
    schemas,
  }
}

export function validateCodexAppServerSchema(
  artifact: CodexAppServerSchemaArtifact
): CodexAppServerSchemaValidation {
  const errors: string[] = []
  if (
    artifact.sha256 !== PINNED_FINGERPRINT ||
    artifact.generator.version !== CODEX_APP_SERVER_SCHEMA_VERSION
  )
    errors.push('pinned-baseline:mismatch')
  for (const [shape, messages] of Object.entries(REQUIRED_SHAPES)) {
    if (!artifact.shapes[shape]) errors.push(`${shape}:shapes:missing`)
    for (const [path, required] of Object.entries(messages)) {
      const schema = artifact.schemas[path]
      if (!artifact.shapes[shape]?.includes(path) || !schema) {
        errors.push(`${shape}:${path}:missing`)
        continue
      }
      if (schema.title !== path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, '')) {
        errors.push(`${shape}:${path}:title`)
      }
      if (schema.type !== 'object') errors.push(`${shape}:${path}:type`)
      for (const field of required) {
        if (!schema.required?.includes(field)) errors.push(`${shape}:${path}:required:${field}`)
      }
    }
  }
  return errors.length === 0 ? { valid: true, errors: [] } : { valid: false, errors }
}

export function createCodexMessageValidator(artifact: CodexAppServerSchemaArtifact) {
  const ajv = new Ajv({
    strict: false,
    allErrors: true,
    formats: { int64: true, int32: true, uint64: true, uint32: true, uint16: true, uint: true },
  })
  const compile = (path: string) => ajv.compile(artifact.schemas[path])
  const requests = Object.fromEntries(
    Object.entries({
      initialize: 'v1/Initialize',
      'thread/start': 'v2/ThreadStart',
      'thread/resume': 'v2/ThreadResume',
      'turn/start': 'v2/TurnStart',
      'turn/interrupt': 'v2/TurnInterrupt',
    }).map(([method, path]) => [
      method,
      { params: compile(`${path}Params.json`), result: compile(`${path}Response.json`) },
    ])
  )
  const notifications = Object.fromEntries(
    Object.entries({
      'item/started': 'ItemStarted',
      'item/completed': 'ItemCompleted',
      'item/agentMessage/delta': 'AgentMessageDelta',
      'turn/completed': 'TurnCompleted',
      error: 'Error',
      'thread/tokenUsage/updated': 'ThreadTokenUsageUpdated',
    }).map(([method, name]) => [method, compile(`v2/${name}Notification.json`)])
  )
  return {
    request: (method: string, value: unknown) => requests[method]?.params(value) ?? true,
    response: (method: string, value: unknown) => requests[method]?.result(value) ?? true,
    notification: (method: string, value: unknown) => notifications[method]?.(value) ?? true,
  }
}

function readFileBytes(path: string): Buffer {
  try {
    return readFileSync(path)
  } catch {
    throw new CodexAppServerSchemaError(
      'schema_artifact_missing',
      'Codex app-server schema artifact is not installed'
    )
  }
}

function readJson(path: string): unknown {
  return parseJson(readFileBytes(path), path)
}

function parseJson(bytes: Buffer, path: string): CodexJsonSchema {
  try {
    return JSON.parse(bytes.toString('utf8')) as CodexJsonSchema
  } catch {
    throw new CodexAppServerSchemaError(
      'schema_artifact_invalid',
      `Codex app-server schema ${path} is not valid JSON`
    )
  }
}

function isMetadata(value: unknown): value is {
  generator: { name: string; version: string }
  sha256: string
  files: Array<{ path: string; sha256?: string }>
  shapes: Record<string, string[]>
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const metadata = value as Record<string, unknown>
  const generator = metadata.generator as Record<string, unknown> | undefined
  if (
    !generator ||
    typeof generator.name !== 'string' ||
    typeof generator.version !== 'string' ||
    typeof metadata.sha256 !== 'string' ||
    !Array.isArray(metadata.files) ||
    typeof metadata.shapes !== 'object' ||
    metadata.shapes === null
  ) {
    return false
  }
  return metadata.files.every(
    (file) =>
      typeof file === 'object' &&
      file !== null &&
      typeof (file as { path?: unknown }).path === 'string'
  )
}

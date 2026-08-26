// `read` direct tool — line-numbered file reads, anywhere on the machine.
//
// Mirrors pi-mono / Claude Code's Read tool semantics so the realtime model's
// prior training transfers: 1-indexed offset, default limit of 2000 lines,
// line-number + tab prefix, per-line and total caps.

import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, resolve, basename, relative } from 'node:path'
import { getWorkspaceRoot } from '../../workspace.js'

export const READ_TOOL_NAME = 'read'

// Match Claude Code / pi-mono description style so the realtime model maps
// "read package.json" → this tool from training prior.
export const READ_TOOL_DESCRIPTION = `Reads a file from the filesystem. Allowed anywhere — not restricted to the workspace.

- The path argument must be an absolute path, or relative to the voiceclaw workspace root.
- Output is line-numbered: each line is prefixed with its 1-indexed line number and a tab.
- By default, reads up to 2000 lines starting from the beginning of the file. Lines longer than 2000 characters are truncated.
- Use offset and limit when you need to read a specific section of a large file. offset is 1-indexed.
- Total output is capped at 100KB; the tail is truncated with a "(... truncated)" marker.
- Returns "(empty file)" for zero-byte files so the model knows the read succeeded.`

export const READ_TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'Absolute filesystem path, or path relative to the voiceclaw workspace root.',
    },
    offset: {
      type: 'integer',
      description: '1-indexed line number to start reading from. Defaults to 1.',
      minimum: 1,
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of lines to return. Defaults to 2000.',
      minimum: 1,
    },
  },
  required: ['path'],
} as const

const DEFAULT_LIMIT = 2000
const MAX_LINE_CHARS = 2000
const MAX_OUTPUT_BYTES = 100 * 1024

export interface ReadArgs {
  path: string
  offset?: number
  limit?: number
}

export interface ReadResult {
  content: string
  truncated?: boolean
  totalLines?: number
  bytesReturned: number
}

export interface ReadError {
  error: string
}

export async function runRead(args: ReadArgs): Promise<ReadResult | ReadError> {
  const rawPath = args.path
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    return { error: 'path is required' }
  }

  const absPath = isAbsolute(rawPath) ? rawPath : resolve(getWorkspaceRoot(), rawPath)

  const guard = checkReadablePath(absPath)
  if (!guard.ok) {
    return { error: guard.reason }
  }

  let raw: string
  try {
    raw = await fs.readFile(absPath, 'utf-8')
  } catch (err) {
    return { error: `read failed: ${(err as Error).message}` }
  }

  if (raw.length === 0) {
    return { content: '(empty file)', bytesReturned: '(empty file)'.length }
  }

  const lines = raw.split('\n')
  // split("\n") on a trailing newline produces a trailing empty entry — drop it
  // so line counts match what the user expects.
  if (lines[lines.length - 1] === '') lines.pop()
  const totalLines = lines.length

  const offset = Math.max(1, Math.floor(args.offset ?? 1))
  const limit = Math.max(1, Math.floor(args.limit ?? DEFAULT_LIMIT))
  const start = offset - 1
  const end = Math.min(totalLines, start + limit)

  if (start >= totalLines) {
    return {
      content: `(offset ${offset} is past end of file; file has ${totalLines} line${totalLines === 1 ? '' : 's'})`,
      bytesReturned: 0,
      totalLines,
    }
  }

  const slice = lines.slice(start, end)

  let out = ''
  let truncated = end < totalLines
  let bytesReturned = 0
  for (let i = 0; i < slice.length; i++) {
    const lineNumber = offset + i
    const original = slice[i]
    const lineText =
      original.length > MAX_LINE_CHARS
        ? `${original.slice(0, MAX_LINE_CHARS)}… (line truncated, ${original.length - MAX_LINE_CHARS} chars omitted)`
        : original
    const formatted = `${lineNumber}\t${lineText}\n`
    if (bytesReturned + formatted.length > MAX_OUTPUT_BYTES) {
      truncated = true
      break
    }
    out += formatted
    bytesReturned += formatted.length
  }

  if (truncated) {
    out += '(... truncated)\n'
  }

  return { content: out, truncated, totalLines, bytesReturned }
}

// Sensitive-path guard. read is intentionally allowed anywhere on disk so the
// model can answer "what's in package.json", "tail this log", etc — but it
// must not become a trivial credential exfiltration tool. The guard rejects:
//   - credential dirs anywhere on the path (.ssh, .aws, .gnupg, .config/gh,
//     .config/op, gcloud, kube)
//   - .env files (any name ending in .env, .env.local, .env.production, ...)
//   - private key / pem / pfx files (suffix match)
//   - the relay's own voiceclaw config dir (~/.voiceclaw outside the workspace
//     itself — settings DB, provider-keys, RELAY_API_KEY all live there)
//
// This is a backstop, not a substitute for upstream auth. A determined
// attacker with a shell session has many other paths to credentials; we just
// don't want a single `read` call to be the easy one.
export interface ReadCheck {
  ok: true
}
export interface ReadDenied {
  ok: false
  reason: string
}
export type ReadCheckResult = ReadCheck | ReadDenied

export function checkReadablePath(absPath: string): ReadCheckResult {
  const home = homedir()
  const normalized = resolve(absPath)
  const portablePath = normalized.replaceAll('\\', '/')
  const lower = portablePath.toLowerCase()

  // Workspace itself is always readable. Path INSIDE the user's workspace
  // never trips the .voiceclaw guard below, even though the workspace lives
  // under ~/.voiceclaw/workspace by default.
  const workspaceRoot = resolve(getWorkspaceRoot())
  const workspaceRelative = relative(workspaceRoot, normalized)
  if (
    workspaceRelative === '' ||
    (!workspaceRelative.startsWith('..') && !isAbsolute(workspaceRelative))
  ) {
    return { ok: true }
  }

  // Filename-only denials (apply anywhere on disk).
  const leaf = basename(normalized)
  if (leaf === '.env' || leaf.startsWith('.env.') || leaf.endsWith('.env')) {
    return { ok: false, reason: `refusing to read environment file: ${normalized}` }
  }
  const suffixDenied = ['.pem', '.key', '.pfx', '.p12', '.asc']
  for (const s of suffixDenied) {
    if (lower.endsWith(s)) {
      return { ok: false, reason: `refusing to read secret file: ${normalized}` }
    }
  }

  // Path-component denials (apply if any segment matches).
  const segments = lower.split('/')
  const denyComponents = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.docker'])
  for (const seg of segments) {
    if (denyComponents.has(seg)) {
      return { ok: false, reason: `refusing to read credential path component: ${seg}` }
    }
  }

  // .config/<tool> for known credential-holding tools.
  const configIdx = segments.indexOf('.config')
  if (configIdx !== -1 && configIdx + 1 < segments.length) {
    const tool = segments[configIdx + 1]
    if (
      tool === 'gh' ||
      tool === 'op' ||
      tool === 'gcloud' ||
      tool === '1password' ||
      tool === 'doctl'
    ) {
      return { ok: false, reason: `refusing to read credential path: .config/${tool}` }
    }
  }

  // VoiceClaw's own secrets — settings DB, provider keys, relay key — live in
  // ~/.voiceclaw (NOT inside ~/.voiceclaw/workspace). The workspace check
  // above passes through workspace reads first; everything else under
  // ~/.voiceclaw is off-limits.
  const voiceclawDir = resolve(home, '.voiceclaw')
  const voiceclawRelative = relative(voiceclawDir, normalized)
  if (
    voiceclawRelative === '' ||
    (!voiceclawRelative.startsWith('..') && !isAbsolute(voiceclawRelative))
  ) {
    return { ok: false, reason: `refusing to read VoiceClaw config dir: ${normalized}` }
  }

  // Common system credential stores.
  if (lower.includes('/keychain')) {
    return { ok: false, reason: `refusing to read keychain path: ${normalized}` }
  }
  if (lower.endsWith('/etc/shadow') || lower.endsWith('/etc/sudoers')) {
    return { ok: false, reason: `refusing to read system credential file: ${normalized}` }
  }

  return { ok: true }
}

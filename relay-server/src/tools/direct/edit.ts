// `edit` direct tool — exact-string find/replace on a file inside the workspace.
//
// Semantics intentionally match Claude Code / pi-mono's Edit:
//   - old_string must exist verbatim in the file (no fuzzy matching here —
//     spec calls for exact-string semantics on day one).
//   - old_string must be unique in the file unless replace_all is set.
//   - old_string === new_string is an error (no-op edits look like bugs).
//   - Empty old_string is rejected (cannot anchor a replacement).
//   - Trailing newline behavior is preserved naturally by string-replace.

import { promises as fs, constants as fsConstants } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  getWorkspaceRoot,
  resolveInsideWorkspace,
  verifyWrittenPathInside,
} from '../../workspace.js'

export const EDIT_TOOL_NAME = 'edit'

export const EDIT_TOOL_DESCRIPTION = `Performs an exact-string find-and-replace on a file inside the voiceclaw workspace (~/.voiceclaw/workspace/).

- The path argument can be absolute (must be inside the workspace) or relative to the workspace root.
- old_string must match the file content exactly, including whitespace and newlines.
- old_string must be unique in the file unless replace_all is true. If it appears more than once and replace_all is false, the call errors with a count of occurrences — provide more surrounding context to make old_string unique, or set replace_all.
- old_string and new_string must differ.
- Errors if the file does not exist or old_string is not found. Use write for new files.
- For longer rewrites it is fine to read the file first, then edit a unique region.`

export const EDIT_TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'Workspace-relative path, or absolute path inside the workspace.',
    },
    old_string: {
      type: 'string',
      description:
        'Exact text to find. Must match the file verbatim, including whitespace and newlines.',
    },
    new_string: {
      type: 'string',
      description: 'Text that replaces old_string. May be empty to delete.',
    },
    replace_all: {
      type: 'boolean',
      description:
        'When true, every occurrence of old_string is replaced. Default false — a non-unique old_string is an error.',
    },
  },
  required: ['path', 'old_string', 'new_string'],
} as const

export interface EditArgs {
  path: string
  old_string: string
  new_string: string
  replace_all?: boolean
}

export interface EditResult {
  replaced: number
  path: string
  bytes: number
}

export interface EditError {
  error: string
}

export async function runEdit(args: EditArgs): Promise<EditResult | EditError> {
  if (typeof args.path !== 'string' || args.path.length === 0) {
    return { error: 'path is required' }
  }
  if (typeof args.old_string !== 'string') {
    return { error: 'old_string is required' }
  }
  if (typeof args.new_string !== 'string') {
    return { error: 'new_string is required' }
  }
  if (args.old_string.length === 0) {
    return { error: 'old_string must not be empty' }
  }
  if (args.old_string === args.new_string) {
    return { error: 'old_string and new_string are identical — no edit to perform' }
  }
  const replaceAll = args.replace_all === true

  const root = getWorkspaceRoot()
  const candidate = isAbsolute(args.path) ? resolve(args.path) : resolve(join(root, args.path))
  if (!isLexicallyInside(candidate, root)) {
    return { error: `path escapes workspace: ${candidate} not inside ${root}` }
  }

  const resolved = await resolveInsideWorkspace(candidate, { allowMissingFile: false })
  if (!resolved.ok || !resolved.resolved) {
    return { error: resolved.reason ?? 'path resolution failed' }
  }

  // Reject leaf symlinks before reading/writing so an existing symlink that
  // currently points inside the workspace can't be re-pointed elsewhere
  // between the realpath check and the open.
  try {
    const leafStat = await fs.lstat(candidate)
    if (leafStat.isSymbolicLink()) {
      return { error: `refusing to edit through symlink: ${candidate}` }
    }
  } catch (err) {
    return { error: `lstat failed: ${(err as Error).message}` }
  }

  let original: string
  try {
    // O_NOFOLLOW on the read fails (ELOOP) if the leaf is suddenly a symlink.
    const readFlags = process.platform === 'win32' ? 'r' : fsConstants.O_RDONLY | noFollowFlag()
    const handle = await fs.open(resolved.resolved, readFlags)
    try {
      original = await handle.readFile('utf-8')
    } finally {
      await handle.close().catch(() => undefined)
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ELOOP' || code === 'EMLINK') {
      return { error: `refusing to edit through symlink: ${resolved.resolved}` }
    }
    return { error: `read failed: ${(err as Error).message}` }
  }

  const occurrences = countOccurrences(original, args.old_string)
  if (occurrences === 0) {
    return {
      error: `old_string not found in ${args.path}. The match must be exact, including whitespace and newlines.`,
    }
  }
  if (occurrences > 1 && !replaceAll) {
    return {
      error: `old_string is not unique in ${args.path} — found ${occurrences} occurrences. Add more surrounding context to make it unique, or set replace_all=true.`,
    }
  }

  let updated: string
  let replaced: number
  if (replaceAll) {
    updated = splitJoin(original, args.old_string, args.new_string)
    replaced = occurrences
  } else {
    const idx = original.indexOf(args.old_string)
    updated =
      original.slice(0, idx) + args.new_string + original.slice(idx + args.old_string.length)
    replaced = 1
  }

  if (updated === original) {
    return { error: `no change after edit — replacement produced identical content` }
  }

  try {
    // O_NOFOLLOW + O_TRUNC: if a symlink raced into place between the read and
    // here, the open fails with ELOOP — we never write through it.
    const writeFlags =
      process.platform === 'win32'
        ? 'w'
        : fsConstants.O_WRONLY | fsConstants.O_TRUNC | noFollowFlag()
    const handle = await fs.open(resolved.resolved, writeFlags)
    try {
      await handle.writeFile(updated, 'utf-8')
    } finally {
      await handle.close().catch(() => undefined)
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ELOOP' || code === 'EMLINK') {
      return { error: `refusing to edit through symlink: ${resolved.resolved}` }
    }
    return { error: `write failed: ${(err as Error).message}` }
  }

  const verify = await verifyWrittenPathInside(resolved.resolved)
  if (!verify.ok) {
    // Restore. We have the original in memory.
    try {
      const writeFlags =
        process.platform === 'win32'
          ? 'w'
          : fsConstants.O_WRONLY | fsConstants.O_TRUNC | noFollowFlag()
      const handle = await fs.open(resolved.resolved, writeFlags)
      try {
        await handle.writeFile(original, 'utf-8')
      } finally {
        await handle.close().catch(() => undefined)
      }
    } catch {
      // best-effort restore
    }
    return { error: verify.reason ?? 'edited path escaped workspace' }
  }

  return {
    replaced,
    path: resolved.resolved,
    bytes: Buffer.byteLength(updated, 'utf-8'),
  }
}

function isLexicallyInside(candidate: string, root: string): boolean {
  const resolvedCandidate = resolve(candidate)
  const resolvedRoot = resolve(root)
  const pathFromRoot = relative(resolvedRoot, resolvedCandidate)
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let from = 0
  while (true) {
    const idx = haystack.indexOf(needle, from)
    if (idx === -1) break
    count++
    from = idx + needle.length
  }
  return count
}

// Replace every occurrence of `needle` with `replacement`. Using split+join
// avoids regex escaping and matches the literal string exactly.
function splitJoin(haystack: string, needle: string, replacement: string): string {
  return haystack.split(needle).join(replacement)
}

function noFollowFlag(): number {
  return process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW
}

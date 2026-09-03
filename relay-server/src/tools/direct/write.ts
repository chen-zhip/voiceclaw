// `write` direct tool — writes content to a file inside the voiceclaw workspace.
//
// Workspace-scoped: rejects paths outside `~/.voiceclaw/workspace/`. The final
// open uses O_NOFOLLOW so a freshly-installed leaf symlink cannot redirect the
// write to an outside target between the containment check and the open.

import { promises as fs, constants as fsConstants } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  getWorkspaceRoot,
  resolveInsideWorkspace,
  verifyWrittenPathInside,
} from '../../workspace.js'

export const WRITE_TOOL_NAME = 'write'

export const WRITE_TOOL_DESCRIPTION = `Writes content to a file inside the voiceclaw workspace (~/.voiceclaw/workspace/).

- The path argument can be absolute (must be inside the workspace) or relative to the workspace root.
- Parent directories are created if missing.
- Overwrites the file if it already exists.
- Writes outside the workspace are rejected with an error.
- Use this for new files. To modify part of an existing file, prefer edit so you don't lose surrounding content.
- To save a voice note to today's memory file, create or append-via-edit on memory/YYYY-MM-DD.md.`

export const WRITE_TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'Workspace-relative path, or absolute path inside the workspace.',
    },
    content: {
      type: 'string',
      description: 'Full file contents. Existing files are overwritten.',
    },
  },
  required: ['path', 'content'],
} as const

export interface WriteArgs {
  path: string
  content: string
}

export interface WriteResult {
  written: true
  bytes: number
  path: string
}

export interface WriteError {
  error: string
}

export async function runWrite(args: WriteArgs): Promise<WriteResult | WriteError> {
  if (typeof args.path !== 'string' || args.path.length === 0) {
    return { error: 'path is required' }
  }
  if (typeof args.content !== 'string') {
    return { error: 'content must be a string' }
  }

  const root = getWorkspaceRoot()
  // Resolve the candidate lexically against the workspace root FIRST. This
  // catches "../../tmp/evil" before any mkdir or open touches disk.
  const candidate = isAbsolute(args.path) ? resolve(args.path) : resolve(join(root, args.path))
  if (!isLexicallyInside(candidate, root)) {
    return { error: `path escapes workspace: ${candidate} not inside ${root}` }
  }
  const candidateParent = dirname(candidate)
  if (!isLexicallyInside(candidateParent, root)) {
    return { error: `parent escapes workspace: ${candidateParent} not inside ${root}` }
  }

  // For absolute paths, refuse to create parents that don't already exist —
  // we can't safely mkdir into territory we haven't proven is inside the
  // workspace. Relative paths are anchored to the workspace root, which is
  // guaranteed inside by construction (after the realpath check below).
  if (isAbsolute(args.path)) {
    try {
      await fs.access(candidateParent)
    } catch {
      return { error: `parent directory does not exist: ${candidateParent}` }
    }
  } else {
    try {
      await fs.mkdir(candidateParent, { recursive: true })
    } catch (err) {
      return { error: `mkdir parent failed: ${(err as Error).message}` }
    }
  }

  const resolved = await resolveInsideWorkspace(candidate, { allowMissingFile: true })
  if (!resolved.ok || !resolved.resolved) {
    return { error: resolved.reason ?? 'path resolution failed' }
  }

  // Reject leaf symlinks BEFORE writing — refuse to follow a freshly-installed
  // symlink to anywhere (even inside the workspace). Combined with the
  // O_NOFOLLOW open below, this closes the TOCTOU window between resolve and
  // write where a symlink swap could redirect content elsewhere.
  try {
    const leafStat = await fs.lstat(resolved.resolved)
    if (leafStat.isSymbolicLink()) {
      return { error: `refusing to write through symlink: ${resolved.resolved}` }
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      return { error: `lstat failed: ${(err as Error).message}` }
    }
    // ENOENT means leaf doesn't exist yet — that's the create case.
  }

  // O_NOFOLLOW on the leaf: if a symlink races into place between lstat and
  // open, the open fails with ELOOP. O_CREAT | O_TRUNC | O_WRONLY mirrors the
  // semantics of writeFile.
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | noFollowFlag()
  let handle: fs.FileHandle
  try {
    handle = await fs.open(resolved.resolved, flags, 0o600)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ELOOP' || code === 'EMLINK') {
      return { error: `refusing to write through symlink: ${resolved.resolved}` }
    }
    return { error: `open failed: ${(err as Error).message}` }
  }

  try {
    await handle.writeFile(args.content, 'utf-8')
  } catch (err) {
    return { error: `write failed: ${(err as Error).message}` }
  } finally {
    await handle.close().catch(() => undefined)
  }

  const verify = await verifyWrittenPathInside(resolved.resolved)
  if (!verify.ok) {
    try {
      await fs.unlink(resolved.resolved)
    } catch {
      // best-effort
    }
    return { error: verify.reason ?? 'written path escaped workspace' }
  }

  return {
    written: true,
    bytes: Buffer.byteLength(args.content, 'utf-8'),
    path: resolved.resolved,
  }
}

function isLexicallyInside(candidate: string, root: string): boolean {
  const resolvedCandidate = resolve(candidate)
  const resolvedRoot = resolve(root)
  const pathFromRoot = relative(resolvedRoot, resolvedCandidate)
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
}

function noFollowFlag(): number {
  return process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW
}

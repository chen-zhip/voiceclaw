import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runEdit } from '../../../src/tools/direct/edit.js'
import { ensureWorkspace, getWorkspaceRoot } from '../../../src/workspace.js'

const symlinkDescribe = process.platform === 'win32' ? describe.skip : describe

describe('edit tool', () => {
  let tmpRoot: string
  let prevEnv: string | undefined

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'voiceclaw-edit-'))
    prevEnv = process.env.VOICECLAW_WORKSPACE
    process.env.VOICECLAW_WORKSPACE = join(tmpRoot, 'workspace')
    await ensureWorkspace()
  })

  afterEach(async () => {
    if (prevEnv === undefined) delete process.env.VOICECLAW_WORKSPACE
    else process.env.VOICECLAW_WORKSPACE = prevEnv
    await rm(tmpRoot, { recursive: true, force: true })
  })

  async function seed(name: string, content: string): Promise<string> {
    const path = join(getWorkspaceRoot(), name)
    await writeFile(path, content, 'utf-8')
    return path
  }

  it('replaces a unique exact-match string', async () => {
    const path = await seed('a.txt', 'alpha\nbeta\ngamma\n')
    const result = await runEdit({ path: 'a.txt', old_string: 'beta', new_string: 'BETA' })
    if ('error' in result) throw new Error(result.error)
    expect(result.replaced).toBe(1)
    expect(await readFile(path, 'utf-8')).toBe('alpha\nBETA\ngamma\n')
  })

  it('preserves trailing newline through an edit', async () => {
    const path = await seed('trail.txt', 'line1\nline2\n')
    const result = await runEdit({ path: 'trail.txt', old_string: 'line2', new_string: 'LINE2' })
    if ('error' in result) throw new Error(result.error)
    expect(await readFile(path, 'utf-8')).toBe('line1\nLINE2\n')
  })

  it('preserves absence of trailing newline through an edit', async () => {
    const path = await seed('notrail.txt', 'line1\nline2')
    const result = await runEdit({ path: 'notrail.txt', old_string: 'line2', new_string: 'LINE2' })
    if ('error' in result) throw new Error(result.error)
    expect(await readFile(path, 'utf-8')).toBe('line1\nLINE2')
  })

  it('errors when old_string is not found', async () => {
    await seed('a.txt', 'alpha\nbeta\n')
    const result = await runEdit({ path: 'a.txt', old_string: 'gamma', new_string: 'GAMMA' })
    expect('error' in result).toBe(true)
    expect((result as { error: string }).error).toMatch(/not found/)
  })

  it('errors when old_string appears more than once (without replace_all)', async () => {
    const path = await seed('dupes.txt', 'x\nx\nx\n')
    const result = await runEdit({ path: 'dupes.txt', old_string: 'x', new_string: 'y' })
    expect('error' in result).toBe(true)
    expect((result as { error: string }).error).toMatch(/3 occurrences/)
    expect(await readFile(path, 'utf-8')).toBe('x\nx\nx\n')
  })

  it('replaces all occurrences when replace_all is true', async () => {
    const path = await seed('dupes.txt', 'x\nx\nx\n')
    const result = await runEdit({
      path: 'dupes.txt',
      old_string: 'x',
      new_string: 'y',
      replace_all: true,
    })
    if ('error' in result) throw new Error(result.error)
    expect(result.replaced).toBe(3)
    expect(await readFile(path, 'utf-8')).toBe('y\ny\ny\n')
  })

  it('errors when old_string is empty', async () => {
    await seed('a.txt', 'alpha\n')
    const result = await runEdit({ path: 'a.txt', old_string: '', new_string: 'x' })
    expect('error' in result).toBe(true)
    expect((result as { error: string }).error).toMatch(/empty/)
  })

  it('errors when old_string equals new_string', async () => {
    await seed('a.txt', 'alpha\n')
    const result = await runEdit({ path: 'a.txt', old_string: 'alpha', new_string: 'alpha' })
    expect('error' in result).toBe(true)
    expect((result as { error: string }).error).toMatch(/identical/)
  })

  it('errors when the file does not exist', async () => {
    const result = await runEdit({ path: 'missing.txt', old_string: 'x', new_string: 'y' })
    expect('error' in result).toBe(true)
  })

  it('rejects edits outside the workspace', async () => {
    const escape = join(tmpRoot, 'outside.txt')
    await writeFile(escape, 'hello\n', 'utf-8')
    const result = await runEdit({ path: escape, old_string: 'hello', new_string: 'world' })
    expect('error' in result).toBe(true)
    expect(await readFile(escape, 'utf-8')).toBe('hello\n')
  })

  it('can delete content by replacing with empty string', async () => {
    const path = await seed('a.txt', 'keep\nremove me\nkeep\n')
    const result = await runEdit({ path: 'a.txt', old_string: 'remove me\n', new_string: '' })
    if ('error' in result) throw new Error(result.error)
    expect(await readFile(path, 'utf-8')).toBe('keep\nkeep\n')
  })

  it('handles multi-line old_string', async () => {
    const path = await seed('a.txt', 'header\nblock one\nblock two\nfooter\n')
    const result = await runEdit({
      path: 'a.txt',
      old_string: 'block one\nblock two',
      new_string: 'BLOCK',
    })
    if ('error' in result) throw new Error(result.error)
    expect(await readFile(path, 'utf-8')).toBe('header\nBLOCK\nfooter\n')
  })

  it('returns the canonical (realpathed) workspace path', async () => {
    await seed('p.txt', 'foo\n')
    const result = await runEdit({ path: 'p.txt', old_string: 'foo', new_string: 'bar' })
    if ('error' in result) throw new Error(result.error)
    expect(result.path).toBe(join(await realpath(getWorkspaceRoot()), 'p.txt'))
  })

  symlinkDescribe('symlink TOCTOU protection', () => {
    it('refuses to edit through a leaf symlink that points outside the workspace', async () => {
      const outside = join(tmpRoot, 'outside.txt')
      await writeFile(outside, 'secret-outside\n', 'utf-8')
      const link = join(getWorkspaceRoot(), 'linked.txt')
      const { symlink } = await import('node:fs/promises')
      await symlink(outside, link)

      const result = await runEdit({
        path: 'linked.txt',
        old_string: 'secret-outside',
        new_string: 'PWNED',
      })
      expect('error' in result).toBe(true)
      expect(await readFile(outside, 'utf-8')).toBe('secret-outside\n')
    })

    it('refuses to edit through a leaf symlink even when it points inside the workspace', async () => {
      const inside = join(getWorkspaceRoot(), 'real.txt')
      await writeFile(inside, 'real\n', 'utf-8')
      const link = join(getWorkspaceRoot(), 'link.txt')
      const { symlink } = await import('node:fs/promises')
      await symlink(inside, link)

      const result = await runEdit({
        path: 'link.txt',
        old_string: 'real',
        new_string: 'fake',
      })
      expect('error' in result).toBe(true)
      expect(await readFile(inside, 'utf-8')).toBe('real\n')
    })
  })
})

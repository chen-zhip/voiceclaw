import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { runRead, checkReadablePath } from '../../../src/tools/direct/read.js'

describe('read tool', () => {
  let tmpRoot: string
  let prevEnv: string | undefined

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'voiceclaw-read-'))
    prevEnv = process.env.VOICECLAW_WORKSPACE
    process.env.VOICECLAW_WORKSPACE = join(tmpRoot, 'workspace')
    await mkdir(process.env.VOICECLAW_WORKSPACE, { recursive: true })
  })

  afterEach(async () => {
    if (prevEnv === undefined) delete process.env.VOICECLAW_WORKSPACE
    else process.env.VOICECLAW_WORKSPACE = prevEnv
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('reads a small file with line numbers prefixed', async () => {
    const path = join(tmpRoot, 'hello.txt')
    await writeFile(path, 'alpha\nbeta\ngamma\n', 'utf-8')
    const result = await runRead({ path })
    if ('error' in result) throw new Error(result.error)
    expect(result.content).toBe('1\talpha\n2\tbeta\n3\tgamma\n')
    expect(result.totalLines).toBe(3)
    expect(result.truncated).toBe(false)
  })

  it('treats a file without trailing newline the same as one with', async () => {
    const path = join(tmpRoot, 'no-nl.txt')
    await writeFile(path, 'a\nb', 'utf-8')
    const result = await runRead({ path })
    if ('error' in result) throw new Error(result.error)
    expect(result.content).toBe('1\ta\n2\tb\n')
    expect(result.totalLines).toBe(2)
  })

  it('returns (empty file) for zero-byte files', async () => {
    const path = join(tmpRoot, 'empty.txt')
    await writeFile(path, '', 'utf-8')
    const result = await runRead({ path })
    if ('error' in result) throw new Error(result.error)
    expect(result.content).toBe('(empty file)')
  })

  it('honors offset (1-indexed) and limit', async () => {
    const path = join(tmpRoot, 'lines.txt')
    await writeFile(path, 'one\ntwo\nthree\nfour\nfive\n', 'utf-8')
    const result = await runRead({ path, offset: 2, limit: 2 })
    if ('error' in result) throw new Error(result.error)
    expect(result.content).toBe('2\ttwo\n3\tthree\n(... truncated)\n')
    expect(result.truncated).toBe(true)
    expect(result.totalLines).toBe(5)
  })

  it('returns a friendly message when offset is past EOF', async () => {
    const path = join(tmpRoot, 'short.txt')
    await writeFile(path, 'x\ny\n', 'utf-8')
    const result = await runRead({ path, offset: 10 })
    if ('error' in result) throw new Error(result.error)
    expect(result.content).toMatch(/past end of file/)
  })

  it('truncates very long lines with an inline marker', async () => {
    const path = join(tmpRoot, 'long.txt')
    const longLine = 'x'.repeat(3000)
    await writeFile(path, longLine + '\n', 'utf-8')
    const result = await runRead({ path })
    if ('error' in result) throw new Error(result.error)
    expect(result.content).toMatch(/line truncated/)
    expect(result.content.length).toBeLessThan(longLine.length + 200)
  })

  it('resolves relative paths against the workspace root', async () => {
    const target = join(process.env.VOICECLAW_WORKSPACE!, 'notes.md')
    await writeFile(target, 'hi\n', 'utf-8')
    const result = await runRead({ path: 'notes.md' })
    if ('error' in result) throw new Error(result.error)
    expect(result.content).toBe('1\thi\n')
  })

  it('can read files outside the workspace (read-only is allowed anywhere)', async () => {
    const path = join(tmpRoot, 'outside.txt')
    await writeFile(path, 'outside-content\n', 'utf-8')
    const result = await runRead({ path })
    if ('error' in result) throw new Error(result.error)
    expect(result.content).toMatch(/outside-content/)
  })

  it('returns an error when the file does not exist', async () => {
    const result = await runRead({ path: join(tmpRoot, 'missing.txt') })
    expect('error' in result).toBe(true)
  })

  it('rejects an empty path', async () => {
    const result = await runRead({ path: '' })
    expect('error' in result).toBe(true)
  })

  describe('sensitive-path guard', () => {
    const home = homedir()

    it('blocks ~/.ssh/* anywhere on path', () => {
      expect(checkReadablePath(join(home, '.ssh', 'id_rsa')).ok).toBe(false)
      expect(checkReadablePath('/Users/anyone/.ssh/config').ok).toBe(false)
    })

    it('blocks ~/.aws / ~/.gnupg / ~/.kube / ~/.docker', () => {
      expect(checkReadablePath(join(home, '.aws', 'credentials')).ok).toBe(false)
      expect(checkReadablePath(join(home, '.gnupg', 'privkeys.kbx')).ok).toBe(false)
      expect(checkReadablePath(join(home, '.kube', 'config')).ok).toBe(false)
      expect(checkReadablePath(join(home, '.docker', 'config.json')).ok).toBe(false)
    })

    it('blocks ~/.config/{gh,op,gcloud,1password,doctl}', () => {
      expect(checkReadablePath(join(home, '.config', 'gh', 'hosts.yml')).ok).toBe(false)
      expect(checkReadablePath(join(home, '.config', 'op', 'config')).ok).toBe(false)
      expect(checkReadablePath(join(home, '.config', 'gcloud', 'credentials.db')).ok).toBe(false)
      expect(checkReadablePath(join(home, '.config', '1password', 'config')).ok).toBe(false)
      expect(checkReadablePath(join(home, '.config', 'doctl', 'config.yaml')).ok).toBe(false)
    })

    it('allows ~/.config for other tools (only known credential dirs are blocked)', () => {
      expect(checkReadablePath(join(home, '.config', 'nvim', 'init.lua')).ok).toBe(true)
    })

    it('blocks .env files anywhere', () => {
      expect(checkReadablePath('/tmp/.env').ok).toBe(false)
      expect(checkReadablePath('/tmp/.env.local').ok).toBe(false)
      expect(checkReadablePath('/Users/me/projects/foo/.env.production').ok).toBe(false)
      // exact match on .env
      expect(checkReadablePath('/var/.env').ok).toBe(false)
    })

    it('blocks PEM / KEY / PFX / P12 / ASC suffixes', () => {
      expect(checkReadablePath('/tmp/cert.pem').ok).toBe(false)
      expect(checkReadablePath('/tmp/id_rsa.key').ok).toBe(false)
      expect(checkReadablePath('/tmp/server.pfx').ok).toBe(false)
      expect(checkReadablePath('/tmp/store.p12').ok).toBe(false)
      expect(checkReadablePath('/tmp/sig.asc').ok).toBe(false)
    })

    it('blocks the VoiceClaw config dir but allows the workspace inside it', () => {
      // ~/.voiceclaw (excluding the workspace subdir) is off limits
      const voiceclawCfg = join(home, '.voiceclaw', 'data.db')
      expect(checkReadablePath(voiceclawCfg).ok).toBe(false)
      // The workspace lives under VOICECLAW_WORKSPACE (set in beforeEach to
      // tmpRoot/workspace) so any path inside it is allowed.
      const wsFile = join(process.env.VOICECLAW_WORKSPACE!, 'notes.md')
      expect(checkReadablePath(wsFile).ok).toBe(true)
    })

    it('blocks system credential files', () => {
      expect(checkReadablePath('/etc/shadow').ok).toBe(false)
      expect(checkReadablePath('/etc/sudoers').ok).toBe(false)
    })

    it('allows ordinary code/log paths', () => {
      expect(checkReadablePath('/tmp/build.log').ok).toBe(true)
      expect(checkReadablePath('/Users/me/projects/foo/package.json').ok).toBe(true)
      expect(checkReadablePath('/var/log/system.log').ok).toBe(true)
    })

    it('runRead surfaces guard error for blocked path', async () => {
      const blocked = join(home, '.ssh', 'id_rsa')
      const result = await runRead({ path: blocked })
      expect('error' in result).toBe(true)
      expect((result as { error: string }).error).toMatch(/credential/i)
    })
  })
})

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PER_STREAM_CAP_BYTES,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  runBash,
} from '../../../src/tools/direct/bash.js'
import { ensureWorkspace, getTasksDir, getWorkspaceRoot } from '../../../src/workspace.js'

const describeOnPosix = process.platform === 'win32' ? describe.skip : describe

describeOnPosix('bash tool', () => {
  let tmpRoot: string
  let prevEnv: string | undefined

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'voiceclaw-bash-'))
    prevEnv = process.env.VOICECLAW_WORKSPACE
    process.env.VOICECLAW_WORKSPACE = join(tmpRoot, 'workspace')
    await ensureWorkspace()
  })

  afterEach(async () => {
    if (prevEnv === undefined) delete process.env.VOICECLAW_WORKSPACE
    else process.env.VOICECLAW_WORKSPACE = prevEnv
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('runs a successful command and returns stdout', async () => {
    const result = await runBash({ command: 'echo hello' })
    if ('error' in result) throw new Error(result.error)
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello')
    expect(result.stderr).toBe('')
    expect(result.timedOut).toBe(false)
  })

  it('captures non-zero exit codes', async () => {
    const result = await runBash({ command: 'exit 7' })
    if ('error' in result) throw new Error(result.error)
    expect(result.exitCode).toBe(7)
  })

  it('captures stderr separately', async () => {
    const result = await runBash({ command: 'echo oops 1>&2' })
    if ('error' in result) throw new Error(result.error)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim()).toBe('oops')
  })

  it('uses the workspace root as default cwd', async () => {
    const result = await runBash({ command: 'pwd' })
    if ('error' in result) throw new Error(result.error)
    // realpath comparison handles macOS /var → /private/var resolution
    const expected = await realpath(getWorkspaceRoot())
    expect(await realpath(result.stdout.trim())).toBe(expected)
  })

  it('streams stdout via onProgress as it arrives', async () => {
    const events: string[] = []
    const result = await runBash(
      { command: 'echo line1; echo line2; echo line3' },
      {
        onProgress: (e) => {
          if (e.textDelta) events.push(e.textDelta)
        },
      }
    )
    if ('error' in result) throw new Error(result.error)
    const joined = events.join('')
    expect(joined).toContain('line1')
    expect(joined).toContain('line2')
    expect(joined).toContain('line3')
  })

  it('caps per-stream output at 16 KB and marks truncated', async () => {
    // Print ~32 KB of stdout.
    const result = await runBash({ command: 'yes x | head -c 32768' }, { onProgress: () => {} })
    if ('error' in result) throw new Error(result.error)
    expect(result.stdoutTruncated).toBe(true)
    const bytes = Buffer.byteLength(result.stdout, 'utf-8')
    expect(bytes).toBeLessThanOrEqual(PER_STREAM_CAP_BYTES + 32) // small slack for boundary alignment
  })

  it('blocks denylisted commands without spawning', async () => {
    const result = await runBash({ command: 'sudo rm -rf /' })
    expect('error' in result).toBe(true)
    expect((result as { error: string }).error).toMatch(/safety policy/)
  })

  it('respects timeout_ms (kills child)', async () => {
    const result = await runBash({ command: 'sleep 5', timeout_ms: 200 })
    if ('error' in result) throw new Error(result.error)
    expect(result.timedOut).toBe(true)
    // Process was killed — exit code may be null, or non-zero from SIGTERM.
    expect(result.exitCode === null || result.exitCode !== 0).toBe(true)
  })

  it('caps timeout_ms at the hard ceiling (silent clamp)', async () => {
    // Smoke check — pass a huge timeout, run something that finishes
    // quickly, and confirm the call returns. The clamp is internal but we
    // can at least verify nothing breaks.
    const result = await runBash({ command: 'echo ok', timeout_ms: 999_999_999 })
    if ('error' in result) throw new Error(result.error)
    expect(result.stdout.trim()).toBe('ok')
  })

  it('aborts when the external signal fires', async () => {
    const controller = new AbortController()
    const promise = runBash({ command: 'sleep 5' }, { signal: controller.signal })
    setTimeout(() => controller.abort(), 50)
    const result = await promise
    if ('error' in result) throw new Error(result.error)
    expect(result.exitCode === null || result.exitCode !== 0).toBe(true)
  })

  it('rejects empty command', async () => {
    const result = await runBash({ command: '' })
    expect('error' in result).toBe(true)
  })

  it('DEFAULT_TIMEOUT_MS is sane', () => {
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(0)
  })

  it('default timeout is 120 seconds (matches the foreground hard cap)', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(120_000)
    expect(MAX_TIMEOUT_MS).toBe(120_000)
  })

  describe('background mode', () => {
    it('returns immediately with jobId + logPath + pid', async () => {
      const start = Date.now()
      const result = await runBash({ command: 'sleep 5', background: true })
      const elapsed = Date.now() - start
      if ('error' in result) throw new Error(result.error)
      if (!('background' in result) || !result.background) {
        throw new Error('expected background result')
      }
      // Return path is just spawn + log open, well under the 5s sleep.
      expect(elapsed).toBeLessThan(2000)
      expect(typeof result.jobId).toBe('string')
      expect(result.jobId.length).toBeGreaterThan(0)
      expect(typeof result.pid === 'number' || result.pid === null).toBe(true)
      expect(result.logPath.startsWith(getTasksDir())).toBe(true)
      expect(result.message).toMatch(/background/i)
    })

    it("writes the command's output to the log file and appends task-exit on completion", async () => {
      const result = await runBash({ command: 'echo hello-from-background', background: true })
      if ('error' in result) throw new Error(result.error)
      if (!('background' in result) || !result.background) {
        throw new Error('expected background result')
      }

      // Spin until the wrapper appends [task-exit N]. echo + exit is fast.
      const deadline = Date.now() + 5000
      let contents = ''
      while (Date.now() < deadline) {
        try {
          contents = await readFile(result.logPath, 'utf-8')
          if (/\[task-exit \d+\]/.test(contents)) break
        } catch {
          /* not yet written */
        }
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(contents).toContain('hello-from-background')
      expect(contents).toMatch(/\[task-exit 0\]/)
    })

    it('captures non-zero exit codes in the task-exit marker', async () => {
      const result = await runBash({ command: 'exit 7', background: true })
      if ('error' in result) throw new Error(result.error)
      if (!('background' in result) || !result.background) {
        throw new Error('expected background result')
      }

      const deadline = Date.now() + 5000
      let contents = ''
      while (Date.now() < deadline) {
        try {
          contents = await readFile(result.logPath, 'utf-8')
          if (/\[task-exit \d+\]/.test(contents)) break
        } catch {
          /* not yet written */
        }
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(contents).toMatch(/\[task-exit 7\]/)
    })

    it('creates the tasks directory if it does not yet exist', async () => {
      // ensureWorkspace already created it in beforeEach — verify it's there.
      const info = await stat(getTasksDir())
      expect(info.isDirectory()).toBe(true)
    })

    it('background log file is unique per job', async () => {
      const a = await runBash({ command: 'echo a', background: true })
      const b = await runBash({ command: 'echo b', background: true })
      if ('error' in a || 'error' in b) throw new Error('background spawn failed')
      if (!('background' in a) || !('background' in b)) throw new Error('expected background')
      expect(a.jobId).not.toBe(b.jobId)
      expect(a.logPath).not.toBe(b.logPath)
    })

    it('respects the bash denylist even in background mode', async () => {
      const result = await runBash({ command: 'sudo rm -rf /', background: true })
      expect('error' in result).toBe(true)
      expect((result as { error: string }).error).toMatch(/safety policy/)
    })

    it('ignores timeout_ms in background mode (job runs detached)', async () => {
      // If we accidentally applied timeout_ms to the detached child, the log
      // would never see [task-exit 0] for a slow command. Use a short sleep
      // and prove it finishes despite a stub timeout.
      const result = await runBash({
        command: 'sleep 1; echo done',
        background: true,
        timeout_ms: 200,
      })
      if ('error' in result) throw new Error(result.error)
      if (!('background' in result) || !result.background) {
        throw new Error('expected background result')
      }

      const deadline = Date.now() + 5000
      let contents = ''
      while (Date.now() < deadline) {
        try {
          contents = await readFile(result.logPath, 'utf-8')
          if (/\[task-exit \d+\]/.test(contents)) break
        } catch {
          /* not yet written */
        }
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(contents).toContain('done')
      expect(contents).toMatch(/\[task-exit 0\]/)
    })
  })
})

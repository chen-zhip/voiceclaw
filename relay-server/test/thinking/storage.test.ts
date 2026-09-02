import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThinkingStorage } from '../../src/thinking/storage.js'

const originalCapture = process.env.VOICECLAW_THINKING_CAPTURE
const originalDirectory = process.env.VOICECLAW_THINKING_DIR
const temporaryDirectories: string[] = []

describe('ThinkingStorage', () => {
  afterEach(async () => {
    restoreEnvironment('VOICECLAW_THINKING_CAPTURE', originalCapture)
    restoreEnvironment('VOICECLAW_THINKING_DIR', originalDirectory)
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true }))
    )
  })

  it('applies privacy configuration', async () => {
    const disabledRoot = await temporaryDirectory()
    await rm(disabledRoot, { recursive: true })
    delete process.env.VOICECLAW_THINKING_CAPTURE

    await new ThinkingStorage({ rootDir: disabledRoot }).append(thinkingEntry('disabled'))

    expect(existsSync(disabledRoot)).toBe(false)

    const enabledRoot = await temporaryDirectory()
    process.env.VOICECLAW_THINKING_CAPTURE = 'enabled'

    await new ThinkingStorage({ rootDir: enabledRoot }).append(thinkingEntry('explicit'))

    expect(existsSync(enabledRoot)).toBe(true)

    const customRoot = join(await temporaryDirectory(), 'custom-thinking')
    process.env.VOICECLAW_THINKING_DIR = customRoot

    await new ThinkingStorage().append(thinkingEntry('custom'))

    expect(existsSync(customRoot)).toBe(true)
  })

  it('appends complete session entries', async () => {
    const rootDir = await temporaryDirectory()
    const storage = new ThinkingStorage({ enabled: true, rootDir })
    const first = thinkingEntry('turn-1')
    const second = thinkingEntry('turn-2')

    await storage.append(first)
    await storage.append(second)

    const lines = (await readFile(join(rootDir, 'session-1.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(lines).toEqual([first, second])
  })

  it('serializes concurrent appends', async () => {
    const rootDir = await temporaryDirectory()
    const lines: string[] = []
    let writing = false
    const storage = new ThinkingStorage({
      enabled: true,
      rootDir,
      appendLine: async (_path, line) => {
        if (writing) throw new Error('concurrent append')
        writing = true
        await Promise.resolve()
        lines.push(line)
        writing = false
      },
    })
    const first = thinkingEntry('turn-1')
    const second = thinkingEntry('turn-2')

    await Promise.all([storage.append(first), storage.append(second)])

    expect(lines.map((line) => JSON.parse(line))).toEqual([first, second])
  })

  it('recovers valid JSONL lines', async () => {
    const rootDir = await temporaryDirectory()
    const first = thinkingEntry('turn-1')
    const second = thinkingEntry('turn-2')
    await writeFile(
      join(rootDir, 'session-1.jsonl'),
      `${JSON.stringify(first)}\n{"broken":\n${JSON.stringify(second)}\n`
    )
    const storage = new ThinkingStorage({ enabled: true, rootDir })

    await expect(storage.load('session-1')).resolves.toEqual([first, second])
  })

  it('keeps writes non-fatal', async () => {
    let releaseSlowWrite: (() => void) | undefined
    const warnings: string[] = []
    const storage = new ThinkingStorage({
      enabled: true,
      rootDir: await temporaryDirectory(),
      appendLine: async (_path, line) => {
        if (line.includes('slow')) {
          await new Promise<void>((resolve) => {
            releaseSlowWrite = resolve
          })
          return
        }
        throw new Error('disk full')
      },
      warn: (message) => warnings.push(message),
    })

    const slowWrite = storage.append(thinkingEntry('slow'))
    const turnEvent = { type: 'turn.ended' }

    expect(turnEvent).toEqual({ type: 'turn.ended' })
    await vi.waitFor(() => expect(releaseSlowWrite).toBeTypeOf('function'))
    releaseSlowWrite?.()
    await slowWrite
    await expect(storage.append(thinkingEntry('failed'))).resolves.toBeNull()
    expect(warnings).toEqual([expect.stringContaining('disk full')])
  })

  it('maintains retention limits', async () => {
    const rootDir = await temporaryDirectory()
    const now = new Date('2026-08-25T00:00:00.000Z').getTime()
    const files = [
      ['oldest.jsonl', 40],
      ['older.jsonl', 20],
      ['recent.jsonl', 10],
      ['newest.jsonl', 1],
    ] as const
    for (const [name, ageInDays] of files) {
      const path = join(rootDir, name)
      await writeFile(path, `${name}-content`)
      const modifiedAt = new Date(now - ageInDays * 24 * 60 * 60 * 1000)
      await utimes(path, modifiedAt, modifiedAt)
    }
    const storage = new ThinkingStorage({
      enabled: true,
      rootDir,
      maxDirectoryBytes: 20,
      now: () => now,
    })

    const result = await storage.maintain()

    expect(result.compressed.map((path) => path.split(/[\\/]/).at(-1))).toEqual([
      'oldest.jsonl.gz',
      'older.jsonl.gz',
    ])
    expect(gunzipSync(await readFile(join(rootDir, 'oldest.jsonl.gz'))).toString()).toBe(
      'oldest.jsonl-content'
    )
    expect(result.cleanupCandidates.map((path) => path.split(/[\\/]/).at(-1))).toEqual([
      'oldest.jsonl.gz',
    ])
  })

  it('automatically schedules retention maintenance', async () => {
    const scheduled: Array<() => Promise<void>> = []
    const storage = new ThinkingStorage({
      enabled: true,
      rootDir: await temporaryDirectory(),
      scheduleMaintenance: (run) => scheduled.push(run),
    })

    await storage.append(thinkingEntry('turn-1'))

    expect(scheduled).toHaveLength(1)
    await expect(scheduled[0]()).resolves.toBeUndefined()
  })

  it('deletes requested thinking data', async () => {
    const rootDir = await temporaryDirectory()
    const storage = new ThinkingStorage({ enabled: true, rootDir })
    await storage.append(thinkingEntry('turn-1'))
    await storage.append({ ...thinkingEntry('turn-2'), sessionId: 'session-2' })

    await storage.deleteSession('session-1')

    expect(existsSync(join(rootDir, 'session-1.jsonl'))).toBe(false)
    expect(existsSync(join(rootDir, 'session-2.jsonl'))).toBe(true)

    await storage.wipe()

    expect(existsSync(rootDir)).toBe(false)
  })

  it('reports safe save metadata', async () => {
    const rootDir = await temporaryDirectory()
    const storage = new ThinkingStorage({ enabled: true, rootDir })

    const result = await storage.append(
      thinkingEntry('turn-1'),
      'https://langfuse.example/trace/trace-1'
    )

    expect(result).toEqual({
      localPath: join(rootDir, 'session-1.jsonl'),
      tracePath: 'https://langfuse.example/trace/trace-1',
    })
    expect(JSON.stringify(result)).not.toContain('Known fixture')
  })
})

function thinkingEntry(turnId: string) {
  return {
    sessionId: 'session-1',
    turnId,
    timestamp: '2026-08-25T00:00:00.000Z',
    thinking: { steps: ['inspect'], reasoning: 'Known fixture' },
    userQuery: 'Find the issue',
    finalOutput: 'Issue found',
  }
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-thinking-'))
  temporaryDirectories.push(directory)
  return directory
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

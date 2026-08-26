import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import type { ThinkingContent } from '../harness-adapter/types.js'
import { warn as logWarning } from '../log.js'

export interface ThinkingEntry {
  sessionId: string
  turnId: string
  timestamp: string
  thinking: ThinkingContent
  userQuery: string
  finalOutput: string
}

export interface ThinkingStorageConfig {
  enabled?: boolean
  rootDir?: string
  appendLine?: (path: string, line: string) => Promise<void>
  warn?: (message: string) => void
  maxDirectoryBytes?: number
  maxAgeMs?: number
  now?: () => number
  scheduleMaintenance?: (run: () => Promise<void>) => void
}

export interface ThinkingMaintenanceResult {
  compressed: string[]
  cleanupCandidates: string[]
}

export interface ThinkingSaveMetadata {
  localPath: string
  tracePath?: string
}

export function getThinkingStorage(): ThinkingStorage {
  return sharedThinkingStorage
}

export class ThinkingStorage {
  private readonly enabled: boolean
  private readonly rootDir: string
  private readonly appendLine: (path: string, line: string) => Promise<void>
  private readonly warn: (message: string) => void
  private readonly maxDirectoryBytes: number
  private readonly maxAgeMs: number
  private readonly now: () => number
  private readonly scheduleMaintenance: (run: () => Promise<void>) => void
  private readonly sessionWrites = new Map<string, Promise<void>>()
  private maintenancePending = false

  constructor(config: ThinkingStorageConfig = {}) {
    this.enabled = config.enabled ?? process.env.VOICECLAW_THINKING_CAPTURE === 'enabled'
    this.rootDir =
      config.rootDir ??
      process.env.VOICECLAW_THINKING_DIR ??
      join(homedir(), '.voiceclaw', 'thinking')
    this.appendLine = config.appendLine ?? appendFile
    this.warn = config.warn ?? ((message) => logWarning(`[thinking-storage] ${message}`))
    this.maxDirectoryBytes = config.maxDirectoryBytes ?? 1024 ** 3
    this.maxAgeMs = config.maxAgeMs ?? 30 * 24 * 60 * 60 * 1000
    this.now = config.now ?? Date.now
    this.scheduleMaintenance =
      config.scheduleMaintenance ??
      ((run) => {
        queueMicrotask(() => void run().catch((error) => this.warnMaintenance(error)))
      })
  }

  async append(entry: ThinkingEntry, tracePath?: string): Promise<ThinkingSaveMetadata | null> {
    if (!this.enabled) return null
    const localPath = thinkingFilePath(this.rootDir, entry.sessionId)
    const previous = this.sessionWrites.get(entry.sessionId) ?? Promise.resolve()
    const write = previous
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.rootDir, { recursive: true })
        await this.appendLine(localPath, `${JSON.stringify(entry)}\n`)
      })
    this.sessionWrites.set(entry.sessionId, write)
    try {
      await write
      this.scheduleAutomaticMaintenance()
      return {
        localPath,
        ...(tracePath ? { tracePath } : {}),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.warn(`Unable to save thinking entry: ${message}`)
      return null
    } finally {
      if (this.sessionWrites.get(entry.sessionId) === write) {
        this.sessionWrites.delete(entry.sessionId)
      }
    }
  }

  async load(sessionId: string): Promise<ThinkingEntry[]> {
    let contents: string
    try {
      contents = await readFile(thinkingFilePath(this.rootDir, sessionId), 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return []
      throw error
    }
    const entries: ThinkingEntry[] = []
    for (const line of contents.split('\n')) {
      if (!line.trim()) continue
      try {
        entries.push(JSON.parse(line) as ThinkingEntry)
      } catch {
        continue
      }
    }
    return entries
  }

  async maintain(): Promise<ThinkingMaintenanceResult> {
    const files = await this.listThinkingFiles()
    const compressed: string[] = []
    const compressedBySource = new Map<string, string>()
    const totalBytes = files.reduce((total, file) => total + file.size, 0)
    if (totalBytes > this.maxDirectoryBytes) {
      const rawFiles = files
        .filter((file) => file.path.endsWith('.jsonl'))
        .sort((left, right) => left.modifiedAt - right.modifiedAt)
      for (const file of rawFiles.slice(0, Math.floor(rawFiles.length / 2))) {
        const compressedPath = `${file.path}.gz`
        const contents = await readFile(file.path)
        await writeFile(compressedPath, await compress(contents))
        await utimes(compressedPath, file.modifiedAt / 1000, file.modifiedAt / 1000)
        await unlink(file.path)
        compressed.push(compressedPath)
        compressedBySource.set(file.path, compressedPath)
      }
    }
    const oldestAllowed = this.now() - this.maxAgeMs
    const cleanupCandidates = files
      .filter((file) => file.modifiedAt < oldestAllowed)
      .map((file) => compressedBySource.get(file.path) ?? file.path)
    return { compressed, cleanupCandidates }
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.sessionWrites.get(sessionId)?.catch(() => undefined)
    const localPath = thinkingFilePath(this.rootDir, sessionId)
    await Promise.all([rm(localPath, { force: true }), rm(`${localPath}.gz`, { force: true })])
  }

  async wipe(): Promise<void> {
    await Promise.allSettled(this.sessionWrites.values())
    this.sessionWrites.clear()
    await rm(this.rootDir, { recursive: true, force: true })
  }

  private async listThinkingFiles(): Promise<ThinkingFile[]> {
    let names: string[]
    try {
      names = await readdir(this.rootDir)
    } catch (error) {
      if (isMissingFile(error)) return []
      throw error
    }
    const files: ThinkingFile[] = []
    for (const name of names) {
      if (!name.endsWith('.jsonl') && !name.endsWith('.jsonl.gz')) continue
      const path = join(this.rootDir, name)
      const details = await stat(path)
      if (details.isFile()) {
        files.push({ path, size: details.size, modifiedAt: details.mtimeMs })
      }
    }
    return files
  }

  private scheduleAutomaticMaintenance(): void {
    if (this.maintenancePending) return
    this.maintenancePending = true
    this.scheduleMaintenance(async () => {
      try {
        await this.maintain()
      } finally {
        this.maintenancePending = false
      }
    })
  }

  private warnMaintenance(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.warn(`Unable to maintain thinking storage: ${message}`)
  }
}

interface ThinkingFile {
  path: string
  size: number
  modifiedAt: number
}

const sharedThinkingStorage = new ThinkingStorage()

const compress = promisify(gzipWithHighCompression)

function gzipWithHighCompression(
  input: Buffer,
  callback: (error: Error | null, result: Buffer) => void
): void {
  gzip(input, { level: 9 }, callback)
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function thinkingFilePath(rootDir: string, sessionId: string): string {
  if (!sessionId) throw new Error('sessionId is required')
  return join(rootDir, `${encodeURIComponent(sessionId)}.jsonl`)
}

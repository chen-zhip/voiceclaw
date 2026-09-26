import { app } from 'electron'
import { appendFileSync, mkdirSync, createWriteStream } from 'fs'
import { join } from 'path'

// Central log directory for VoiceClaw + the services it spawns. Creating
// writes under ~/Library/Logs/VoiceClaw/ on macOS (per Apple convention)
// so logs survive app uninstalls (matches `feedback_no_data_wipe` rule)
// and are easy to tail via Console.app.

let logDir: string | null = null

export function getLogDir(): string {
  if (logDir) return logDir
  // app.getPath('logs') maps to ~/Library/Logs/<AppName>/ on darwin.
  const dir = app.getPath('logs')
  mkdirSync(dir, { recursive: true })
  logDir = dir
  return dir
}

export function openLogStream(filename: string): ReturnType<typeof createWriteStream> {
  const dir = getLogDir()
  const path = join(dir, filename)
  return createWriteStream(path, { flags: 'a' })
}

export function logFilePath(filename: string): string {
  return join(getLogDir(), filename)
}

// Best-effort append for low-volume diagnostic lines that must survive the
// process that produced them; callers still print through their own channel.
export function appendLogLine(filename: string, line: string): void {
  try {
    appendFileSync(logFilePath(filename), `${line}\n`)
  } catch {
    // Losing a diagnostic line must never take a running service down.
  }
}

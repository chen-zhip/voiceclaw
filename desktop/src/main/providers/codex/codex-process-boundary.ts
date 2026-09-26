import { execFile, spawn, spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CodexContributionBoundary } from './codex-provider.js'

export interface CodexProcessHandle {
  pid: number
  write(data: string): void
  onStdout(handler: (chunk: string) => void): void
  onStderr?(handler: (chunk: string) => void): void
  onExit(handler: () => void): void
  kill(): void
}

export interface CodexProcessRunner {
  run(
    file: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; cwd?: string }
  ): Promise<{ code: number; stdout: string; stderr: string }>
  spawn(
    file: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; cwd: string }
  ): CodexProcessHandle
}

export function createCodexProcessBoundary(options: {
  environment?: NodeJS.ProcessEnv
  homeDirectory?: string
  runner?: CodexProcessRunner
}): CodexContributionBoundary {
  const environment = codexProcessEnvironment(
    options.environment ?? process.env,
    options.homeDirectory
  )
  const runner = options.runner ?? createNodeProcessRunner()
  const owned = new Map<number, () => void>()

  return {
    async detectExecutable(path: string): Promise<boolean> {
      try {
        const result = await runner.run(path, ['--version'], { env: environment })
        return result.code === 0
      } catch {
        return false
      }
    },
    async detectVersion(path: string): Promise<string> {
      return (await runner.run(path, ['--version'], { env: environment })).stdout
    },
    async start(input: { executablePath: string; args: string[]; cwd: string }) {
      const handle = runner.spawn(input.executablePath, input.args, {
        env: environment,
        cwd: input.cwd,
      })
      owned.set(handle.pid, () => handle.kill())
      return {
        pid: handle.pid,
        channel: {
          write: (data: string) => handle.write(data),
          onData: (handler: (chunk: string) => void) => handle.onStdout(handler),
          // The Host keeps a bounded tail of these; leaving the pipe undrained
          // would eventually block a chatty app-server mid-handshake.
          onDiagnostic: (handler: (chunk: string) => void) => handle.onStderr?.(handler),
          onExit: (handler: () => void) => handle.onExit(handler),
        },
      }
    },
    async terminate(pid: number): Promise<void> {
      const kill = owned.get(pid)
      if (!kill) return
      owned.delete(pid)
      kill()
    },
  }
}

export function codexProcessEnvironment(
  environment: NodeJS.ProcessEnv,
  homeDirectory?: string
): NodeJS.ProcessEnv {
  const home = homeDirectory ?? environment.HOME ?? environment.USERPROFILE ?? homedir()
  return {
    ...environment,
    HOME: home,
    CODEX_HOME: environment.CODEX_HOME ?? join(home, '.codex'),
  }
}

function createNodeProcessRunner(): CodexProcessRunner {
  return {
    run(file, args, options) {
      return new Promise((resolve) => {
        const done = (code: number, stdout: unknown, stderr: unknown) =>
          resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
        const onError = (error: NodeJS.ErrnoException | null, stdout?: unknown, stderr?: unknown) =>
          done(error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr)
        if (needsShell(file)) {
          execFile(
            commandLine(file, args),
            { env: options.env, cwd: options.cwd, windowsHide: true, shell: true },
            onError
          )
          return
        }
        execFile(file, args, { env: options.env, cwd: options.cwd, windowsHide: true }, onError)
      })
    },
    spawn(file, args, options) {
      const settings = {
        env: options.env,
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'] as Array<'pipe'>,
        windowsHide: true,
      }
      const child = needsShell(file)
        ? spawn(commandLine(file, args), { ...settings, shell: true })
        : spawn(file, args, settings)
      return {
        pid: child.pid ?? 0,
        write: (data) => child.stdin?.write(data),
        onStdout: (handler) =>
          child.stdout?.on('data', (chunk: Buffer) => handler(chunk.toString())),
        onStderr: (handler) =>
          child.stderr?.on('data', (chunk: Buffer) => handler(chunk.toString())),
        onExit: (handler) => child.on('exit', () => handler()),
        kill: () => terminateProcessTree(child.pid ?? 0),
      }
    },
  }
}

function needsShell(file: string): boolean {
  return process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(file)
}

function commandLine(file: string, args: string[]): string {
  return [`"${file}"`, ...args.map((argument) => `"${argument}"`)].join(' ')
}

function terminateProcessTree(pid: number): void {
  if (pid <= 0) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  try {
    process.kill(pid)
  } catch {
    // The process already exited.
  }
}

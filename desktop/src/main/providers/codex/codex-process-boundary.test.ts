import { describe, expect, it } from 'vitest'
import type { CodexProcessRunner } from './codex-process-boundary.js'

function createRunner(version: { code: number; stdout: string }) {
  const calls = {
    run: [] as Array<{ file: string; args: string[]; env: NodeJS.ProcessEnv }>,
    spawn: [] as Array<{ file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }>,
    writes: [] as string[],
    killed: [] as number[],
  }
  const handlers: {
    stdout?: (chunk: string) => void
    stderr?: (chunk: string) => void
    exit?: () => void
  } = {}
  const runner: CodexProcessRunner = {
    run: async (file, args, options) => {
      calls.run.push({ file, args, env: options.env })
      return { code: version.code, stdout: version.stdout, stderr: '' }
    },
    spawn: (file, args, options) => {
      calls.spawn.push({ file, args, cwd: options.cwd, env: options.env })
      return {
        pid: 4242,
        write: (data) => calls.writes.push(data),
        onStdout: (handler) => {
          handlers.stdout = handler
        },
        onStderr: (handler) => {
          handlers.stderr = handler
        },
        onExit: (handler) => {
          handlers.exit = handler
        },
        kill: () => calls.killed.push(4242),
      }
    },
  }
  return {
    runner,
    calls,
    emitStdout: (chunk: string) => handlers.stdout?.(chunk),
    emitStderr: (chunk: string) => handlers.stderr?.(chunk),
    emitExit: () => handlers.exit?.(),
  }
}

describe('Codex production process boundary', () => {
  it('detects the configured executable with an explicit Codex environment', async () => {
    const { runner, calls } = createRunner({ code: 0, stdout: 'codex-cli 0.153.4\n' })
    const { createCodexProcessBoundary } = await import('./codex-process-boundary.js')
    const boundary = createCodexProcessBoundary({
      environment: { PATH: 'C:\\bin' },
      homeDirectory: 'C:\\Users\\tester',
      runner,
    })

    await expect(boundary.detectExecutable('C:\\tools\\codex.exe')).resolves.toBe(true)
    await expect(boundary.detectVersion('C:\\tools\\codex.exe')).resolves.toContain('0.153.4')

    expect(calls.run[0].args).toEqual(['--version'])
    expect(calls.run[0].env).toMatchObject({
      PATH: 'C:\\bin',
      HOME: 'C:\\Users\\tester',
      CODEX_HOME: 'C:\\Users\\tester\\.codex',
    })
  })

  it('reports an executable that cannot run as missing', async () => {
    const { runner } = createRunner({ code: 1, stdout: '' })
    const { createCodexProcessBoundary } = await import('./codex-process-boundary.js')
    const boundary = createCodexProcessBoundary({ environment: {}, runner })

    await expect(boundary.detectExecutable('C:\\tools\\missing.exe')).resolves.toBe(false)
  })

  it('streams the started app-server to the caller', async () => {
    const { runner, calls, emitStdout, emitExit } = createRunner({ code: 0, stdout: '' })
    const { createCodexProcessBoundary } = await import('./codex-process-boundary.js')
    const boundary = createCodexProcessBoundary({ environment: {}, runner })

    const started = await boundary.start({
      executablePath: 'C:\\tools\\codex.exe',
      args: ['app-server'],
      cwd: 'C:\\workspaces\\first',
    })
    const received: string[] = []
    let exited = false
    started.channel.onData((chunk) => received.push(chunk))
    started.channel.onExit?.(() => {
      exited = true
    })
    started.channel.write('{"jsonrpc":"2.0"}\n')
    emitStdout('{"jsonrpc":"2.0","id":1}\n')
    emitExit()

    expect(started.pid).toBe(4242)
    expect(calls.spawn[0]).toMatchObject({
      file: 'C:\\tools\\codex.exe',
      args: ['app-server'],
      cwd: 'C:\\workspaces\\first',
    })
    expect(calls.writes).toEqual(['{"jsonrpc":"2.0"}\n'])
    expect(received).toEqual(['{"jsonrpc":"2.0","id":1}\n'])
    expect(exited).toBe(true)
  })

  it('streams provider diagnostics without touching the protocol channel', async () => {
    const { runner, emitStderr, emitStdout } = createRunner({ code: 0, stdout: '' })
    const { createCodexProcessBoundary } = await import('./codex-process-boundary.js')
    const boundary = createCodexProcessBoundary({ environment: {}, runner })

    const started = await boundary.start({
      executablePath: 'C:\\tools\\codex.exe',
      args: ['app-server'],
      cwd: 'C:\\workspaces\\first',
    })
    const protocol: string[] = []
    const diagnostics: string[] = []
    started.channel.onData((chunk) => protocol.push(chunk))
    started.channel.onDiagnostic?.((chunk) => diagnostics.push(chunk))
    emitStderr('Error: failed to initialize sqlite state runtime\n')
    emitStdout('{"jsonrpc":"2.0","id":1}\n')

    expect(diagnostics).toEqual(['Error: failed to initialize sqlite state runtime\n'])
    expect(protocol).toEqual(['{"jsonrpc":"2.0","id":1}\n'])
  })

  it('terminates only a process this boundary started', async () => {
    const { runner, calls } = createRunner({ code: 0, stdout: '' })
    const { createCodexProcessBoundary } = await import('./codex-process-boundary.js')
    const boundary = createCodexProcessBoundary({ environment: {}, runner })

    await boundary.start({
      executablePath: 'C:\\tools\\codex.exe',
      args: ['app-server'],
      cwd: 'C:\\workspaces\\first',
    })
    await boundary.terminate(9999)
    expect(calls.killed).toEqual([])

    await boundary.terminate(4242)
    expect(calls.killed).toEqual([4242])
  })
})

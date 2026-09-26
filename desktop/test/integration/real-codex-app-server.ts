import { execFile, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { HarnessExecutionEvent } from '@voiceclaw/contracts'
import {
  createCodexContribution,
  type CodexContributionBoundary,
  type CodexProcessChannel,
} from '../../src/main/providers/codex/codex-provider.js'

const run = promisify(execFile)
const windows = process.platform === 'win32'

function commandLine(executable: string, args: string[]): string {
  return [`"${executable}"`, ...args.map((argument) => `"${argument}"`)].join(' ')
}

async function runCommand(executable: string, args: string[], environment: NodeJS.ProcessEnv) {
  return windows
    ? run(commandLine(executable, args), { env: environment, shell: true, windowsHide: true })
    : run(executable, args, { env: environment })
}

async function terminateProcessTree(pid: number): Promise<void> {
  if (!windows) {
    process.kill(pid)
    return
  }
  await new Promise<void>((resolve) => {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => resolve())
  })
}

export const codexExecutable = process.env.VOICECLAW_CODEX_E2E_EXECUTABLE
export const sttCredential = process.env.VOICECLAW_E2E_STT_API_KEY
export const ttsCredential = process.env.VOICECLAW_E2E_TTS_API_KEY

export const codexOptInReason =
  'Real Codex acceptance requires VOICECLAW_CODEX_E2E_EXECUTABLE pointing at an installed, working codex-cli 0.153.4'

export const voiceOptInReason = `${codexOptInReason}, plus VOICECLAW_E2E_STT_API_KEY and VOICECLAW_E2E_TTS_API_KEY for the voice loop`

export function codexProcessEnvironment(): NodeJS.ProcessEnv {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir()
  return {
    ...process.env,
    HOME: home,
    CODEX_HOME: process.env.CODEX_HOME ?? join(home, '.codex'),
  }
}

export interface RealCodexTurnResult {
  version: string
  described: Record<string, unknown>
  threadId: string
  events: HarnessExecutionEvent[]
}

export async function runRealCodexTurn(input: {
  executable: string
  workspacePath: string
  inputText?: string
}): Promise<RealCodexTurnResult> {
  const contribution = createCodexContribution({
    activeHostId: 'host-1',
    configuration: {
      bindingId: 'binding-1',
      workspaceBindingId: 'workspace-1',
      workspacePath: input.workspacePath,
      executablePath: input.executable,
      preferences: {},
      secretRefs: {},
    },
    boundary: createRealCodexBoundary(input.executable),
    clientVersion: '0.10.51',
  })
  const envelope = (operation: string, invocationId: string) => ({
    contract: { id: 'harness.execution' as const, version: '1.0.0' },
    operation,
    invocationId,
    principal: { kind: 'contribution' as const, id: 'routing' },
    scope: { kind: 'workspace' as const, id: 'workspace-1' },
    selectedContribution: {
      packageId: 'voiceclaw-provider-codex',
      contributionId: 'codex-provider',
    },
    generation: 1,
    trace: { traceId: 'trace-acceptance' },
    cancellation: { supported: true, token: 'cancel-acceptance' },
  })

  try {
    const version = (await runCommand(input.executable, ['--version'], codexProcessEnvironment()))
      .stdout
    const described = (await contribution.invoke({
      envelope: envelope('provider.describe', 'describe-acceptance'),
      payload: {},
    })) as Record<string, unknown>
    const ensured = (await contribution.invoke({
      envelope: envelope('thread.ensure', 'thread-acceptance'),
      payload: {
        bindingId: 'binding-1',
        workspaceBindingId: 'workspace-1',
        conversationId: 'conversation-acceptance',
      },
    })) as { threadId: string }
    const events = (await contribution.invoke({
      envelope: envelope('turn.start', 'turn-acceptance'),
      payload: {
        bindingId: 'binding-1',
        threadId: ensured.threadId,
        turnId: 'turn-1',
        attemptId: 'attempt-1',
        generation: 1,
        input: { text: input.inputText ?? 'Reply with one short sentence that greets the user.' },
      },
    })) as HarnessExecutionEvent[]
    return { version: version.trim(), described, threadId: ensured.threadId, events }
  } finally {
    await contribution.dispose?.()
  }
}

export function createRealCodexBoundary(codexExecutablePath: string): CodexContributionBoundary {
  const environment = codexProcessEnvironment()
  return {
    detectExecutable: async (path) => {
      try {
        await runCommand(path, ['--version'], environment)
        return true
      } catch {
        return false
      }
    },
    detectVersion: async (path) => (await runCommand(path, ['--version'], environment)).stdout,
    start: async ({ executablePath, args, cwd }) => {
      const child = windows
        ? spawn(commandLine(executablePath, args), {
            cwd,
            env: environment,
            shell: true,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
          })
        : spawn(executablePath, args, {
            cwd,
            env: environment,
            stdio: ['pipe', 'pipe', 'pipe'],
          })
      const channel: CodexProcessChannel = {
        write: (data) => child.stdin.write(data),
        onData: (handler) => child.stdout.on('data', (chunk: Buffer) => handler(chunk.toString())),
        onExit: (handler) => child.on('exit', () => handler()),
      }
      return { pid: child.pid ?? 0, channel }
    },
    terminate: async (pid) => {
      await terminateProcessTree(pid)
    },
  }
}

import type { CodexContributionBoundary, CodexProcessChannel } from './codex-provider.js'

const SIMULATED_VERSION = 'codex-cli 0.153.4 (simulated)'

export function createSimulatedCodexBoundary(): CodexContributionBoundary {
  let nextPid = 50_000
  let nextThread = 1
  let nextTurn = 1
  const exits = new Map<number, () => void>()

  return {
    detectExecutable: async () => true,
    detectVersion: async () => SIMULATED_VERSION,
    start: async (input) => {
      const pid = nextPid++
      let onData: ((chunk: string) => void) | undefined
      let onExit: (() => void) | undefined
      const channel: CodexProcessChannel = {
        write(data) {
          for (const line of data.split(/\r?\n/).filter((item) => item.trim().length > 0)) {
            handleRequest(JSON.parse(line) as JsonRpcRequest)
          }
        },
        onData(handler) {
          onData = handler
        },
        onExit(handler) {
          onExit = handler
        },
      }
      exits.set(pid, () => onExit?.())

      const respond = (id: number, result: Record<string, unknown>): void => {
        queueMicrotask(() => onData?.(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`))
      }
      const notify = (method: string, params: Record<string, unknown>): void => {
        queueMicrotask(() => onData?.(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`))
      }
      const handleRequest = (request: JsonRpcRequest): void => {
        if (request.method === 'initialize') {
          respond(request.id, {
            codexHome: 'simulated',
            platformFamily: 'simulated',
            platformOs: 'simulated',
            userAgent: SIMULATED_VERSION,
          })
          return
        }
        if (request.method === 'thread/start') {
          respond(request.id, threadResponse(`sim-thread-${nextThread++}`, input.cwd))
          return
        }
        if (request.method === 'thread/resume') {
          respond(request.id, threadResponse(String(request.params.threadId), input.cwd))
          return
        }
        if (request.method === 'turn/start') {
          const turnId = `sim-turn-${nextTurn++}`
          const text = readInputText(request.params.input)
          respond(request.id, { turn: { id: turnId, items: [], status: 'inProgress' } })
          const response = `Simulated Codex response to: ${text}`
          const structuredResponse = JSON.stringify({
            speech: { content: response },
            text: { content: response, format: 'plain' },
          })
          notify('item/agentMessage/delta', {
            threadId: request.params.threadId,
            turnId,
            itemId: 'sim-item-1',
            delta: structuredResponse,
          })
          notify('item/completed', {
            threadId: request.params.threadId,
            turnId,
            completedAtMs: Date.now(),
            item: { type: 'agentMessage', id: 'sim-item-1', text: structuredResponse },
          })
          notify('turn/completed', {
            threadId: request.params.threadId,
            turnId,
            turn: { id: turnId, items: [], status: 'completed' },
          })
          return
        }
        if (request.method === 'turn/interrupt') {
          respond(request.id, {})
          notify('turn/completed', {
            threadId: request.params.threadId,
            turnId: request.params.turnId,
            turn: { id: request.params.turnId, items: [], status: 'interrupted' },
          })
          return
        }
        respond(request.id, {})
      }

      return { pid, channel }
    },
    terminate: async (pid) => {
      exits.get(pid)?.()
      exits.delete(pid)
    },
  }
}

interface JsonRpcRequest {
  id: number
  method: string
  params: Record<string, unknown>
}

function readInputText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  const item = value.find(
    (candidate): candidate is { type: string; text?: unknown } =>
      typeof candidate === 'object' && candidate !== null && 'type' in candidate
  )
  return item?.type === 'text' && typeof item.text === 'string' ? item.text : ''
}

function threadResponse(id: string, cwd: string) {
  return {
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    cwd,
    model: 'simulated',
    modelProvider: 'openai',
    sandbox: { type: 'readOnly' },
    thread: {
      id,
      cwd,
      cliVersion: '0.153.4',
      createdAt: 0,
      updatedAt: 0,
      ephemeral: true,
      modelProvider: 'openai',
      preview: '',
      projectId: null,
      sessionId: id,
      source: 'appServer',
      status: { type: 'idle' },
      turns: [],
    },
  }
}

import { isNonemptyString, isRecord } from '@voiceclaw/contracts'

export interface CodexThreadMapping {
  conversationId: string
  providerId: string
  workspaceBindingId: string
}

export interface CodexEnsuredThread {
  threadId: string
  resumed: boolean
}

export class CodexThreadMappingError extends Error {
  constructor(
    readonly code: 'codex_thread_mapping_failed',
    message: string
  ) {
    super(message)
    this.name = 'CodexThreadMappingError'
  }
}

export class CodexThreadRegistry {
  readonly #threads = new Map<string, string>()
  readonly #inFlight = new Map<string, Promise<CodexEnsuredThread>>()

  constructor(
    private readonly boundary: {
      request(method: string, params: Record<string, unknown>): Promise<unknown>
    }
  ) {}

  async ensure(input: {
    mapping: CodexThreadMapping
    workspacePath: string
  }): Promise<CodexEnsuredThread> {
    const key = mappingKey(input.mapping)
    const inFlight = this.#inFlight.get(key)
    if (inFlight) {
      const created = await inFlight
      return { threadId: created.threadId, resumed: true }
    }

    const known = this.#threads.get(key)
    if (known) {
      const resumed = await this.boundary.request('thread/resume', { threadId: known })
      return { threadId: requireThreadId(resumed), resumed: true }
    }

    const creation = this.#create(key, input.workspacePath)
    this.#inFlight.set(key, creation)
    try {
      return await creation
    } finally {
      this.#inFlight.delete(key)
    }
  }

  async #create(key: string, workspacePath: string): Promise<CodexEnsuredThread> {
    const created = await this.boundary.request('thread/start', { cwd: workspacePath })
    const threadId = requireThreadId(created)
    this.#threads.set(key, threadId)
    return { threadId, resumed: false }
  }
}

function requireThreadId(value: unknown): string {
  const thread = isRecord(value) ? value.thread : undefined
  const threadId = isRecord(thread) ? thread.id : undefined
  if (!isNonemptyString(threadId)) {
    throw new CodexThreadMappingError(
      'codex_thread_mapping_failed',
      'Codex app-server returned an unusable Thread response'
    )
  }
  return threadId
}

function mappingKey(mapping: CodexThreadMapping): string {
  return `${mapping.providerId}\u0000${mapping.conversationId}\u0000${mapping.workspaceBindingId}`
}

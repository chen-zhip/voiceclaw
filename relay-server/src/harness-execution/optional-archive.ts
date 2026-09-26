import type { HarnessExecutionEvent } from '@voiceclaw/contracts'

interface ArchiveProvider {
  contract: { id: string; version: string }
  invoke(operation: 'archive.append', event: HarnessExecutionEvent): Promise<unknown>
}

interface OptionalArchiveConsumerOptions {
  workspaceBindingId: string
  resolveProvider(): ArchiveProvider | undefined
  authorize(request: {
    principalId: string
    contractId: string
    operation: string
    scope: { kind: string; id: string }
    workspaceBindingId: string
  }): boolean
  timeoutMs?: number
  projectStatus?(status: ArchiveStatus): void
}

type ArchiveStatus =
  | {
      availability: 'absent' | 'unauthorized'
      persistence: 'session-only'
    }
  | {
      availability: 'available'
      persistence: 'archive'
    }
  | {
      availability: 'degraded'
      persistence: 'session-only'
      reason: 'rejected' | 'timeout' | 'disconnected'
    }

export class OptionalArchiveConsumer {
  #status: ArchiveStatus = { availability: 'absent', persistence: 'session-only' }

  constructor(private readonly options: OptionalArchiveConsumerOptions) {}

  async accept(event: HarnessExecutionEvent): Promise<void> {
    if (this.#status.availability === 'degraded') return
    const provider = this.options.resolveProvider()
    if (!isCompatible(provider)) {
      this.#status = { availability: 'absent', persistence: 'session-only' }
      return
    }
    const authorized = this.options.authorize({
      principalId: 'routing',
      contractId: 'archive.append',
      operation: 'append',
      scope: { kind: 'workspace', id: this.options.workspaceBindingId },
      workspaceBindingId: this.options.workspaceBindingId,
    })
    if (!authorized) {
      this.#status = { availability: 'unauthorized', persistence: 'session-only' }
      return
    }
    try {
      await withTimeout(
        provider.invoke('archive.append', structuredClone(event)),
        this.options.timeoutMs ?? 10_000
      )
      this.#status = { availability: 'available', persistence: 'archive' }
    } catch (error) {
      const reason = failureReason(error)
      this.#status = { availability: 'degraded', persistence: 'session-only', reason }
      this.options.projectStatus?.(structuredClone(this.#status))
    }
  }

  status() {
    return structuredClone(this.#status)
  }
}

function isCompatible(provider: ArchiveProvider | undefined): provider is ArchiveProvider {
  return (
    provider?.contract.id === 'archive.append' &&
    /^1\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(provider.contract.version)
  )
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Object.assign(new Error('Archive append timed out'), { code: 'timeout' })),
      timeoutMs
    )
    operation.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    )
  })
}

function failureReason(error: unknown): 'rejected' | 'timeout' | 'disconnected' {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  if (code === 'timeout') return 'timeout'
  if (code === 'disconnected') return 'disconnected'
  return 'rejected'
}

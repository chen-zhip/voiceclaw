interface MemoryProvider {
  contract: { id: string; version: string }
  invoke(operation: string, payload: Record<string, unknown>): Promise<unknown>
}

interface MemoryAuthorizationRequest {
  principalId: string
  contractId: string
  operation: string
  scope: { kind: string; id: string }
  workspaceBindingId: string
}

interface OptionalMemoryConsumerOptions {
  workspaceBindingId: string
  resolveProvider(contractId: string): MemoryProvider | undefined
  authorize(request: MemoryAuthorizationRequest): boolean
  timeoutMs?: number
  projectStatus?(status: MemoryStatus): void
}

type MemoryStatus =
  | {
      availability: 'absent' | 'unauthorized' | 'available'
      controls: Array<'retrieval' | 'inclusion'>
    }
  | {
      availability: 'degraded'
      controls: Array<'retrieval' | 'inclusion'>
      reason: 'rejected' | 'timeout' | 'disconnected'
    }

export class OptionalMemoryConsumer {
  #status: MemoryStatus = { availability: 'absent', controls: [] }

  constructor(private readonly options: OptionalMemoryConsumerOptions) {}

  async run<T>(
    input: Record<string, unknown>,
    dispatch: (input: Record<string, unknown>) => Promise<T>
  ): Promise<{ outcome: T; memory: MemoryStatus }> {
    const read = this.#resolveAuthorized('memory.read', 'retrieve')
    const include = this.#resolveAuthorized('memory.include', 'include')
    const controls: MemoryStatus['controls'] = [
      ...(read ? (['retrieval'] as const) : []),
      ...(include ? (['inclusion'] as const) : []),
    ]
    this.#status = {
      availability: controls.length > 0 ? 'available' : this.#availabilityWithoutGrant(),
      controls,
    }

    let dispatchInput = structuredClone(input)
    if (read) {
      try {
        const result = await withTimeout(
          read.invoke('retrieve', structuredClone(input)),
          this.options.timeoutMs ?? 10_000
        )
        if (isRecord(result) && isRecord(result.context)) {
          dispatchInput = { ...dispatchInput, memoryContext: structuredClone(result.context) }
        }
      } catch (error) {
        this.#status = {
          availability: 'degraded',
          controls,
          reason: failureReason(error),
        }
        this.options.projectStatus?.(this.status())
      }
    }
    const outcome = await dispatch(dispatchInput)
    return { outcome, memory: this.status() }
  }

  async include(evidence: Record<string, unknown>): Promise<boolean> {
    const provider = this.#resolveAuthorized('memory.include', 'include')
    if (!provider) {
      this.#status = {
        availability: this.#availabilityWithoutGrant(),
        controls: [],
      }
      return false
    }
    await provider.invoke('include', structuredClone(evidence))
    return true
  }

  status(): MemoryStatus {
    return structuredClone(this.#status)
  }

  #resolveAuthorized(contractId: string, operation: string): MemoryProvider | undefined {
    const provider = this.options.resolveProvider(contractId)
    if (!isCompatible(provider, contractId)) return undefined
    return this.options.authorize({
      principalId: 'routing',
      contractId,
      operation,
      scope: { kind: 'workspace', id: this.options.workspaceBindingId },
      workspaceBindingId: this.options.workspaceBindingId,
    })
      ? provider
      : undefined
  }

  #availabilityWithoutGrant(): 'absent' | 'unauthorized' {
    const providers = [
      this.options.resolveProvider('memory.read'),
      this.options.resolveProvider('memory.include'),
    ]
    return providers.some(Boolean) ? 'unauthorized' : 'absent'
  }
}

function isCompatible(
  provider: MemoryProvider | undefined,
  contractId: string
): provider is MemoryProvider {
  return (
    provider?.contract.id === contractId &&
    /^1\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(provider.contract.version)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Object.assign(new Error('Memory retrieval timed out'), { code: 'timeout' })),
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

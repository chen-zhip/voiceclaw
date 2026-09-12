import { describe, expect, it, vi } from 'vitest'

describe('optional Memory routing', () => {
  it('runs without a Memory provider', async () => {
    const memoryModule = await import('../../src/harness-execution/optional-memory.js').catch(
      () => ({})
    )
    const OptionalMemoryConsumer = Reflect.get(memoryModule, 'OptionalMemoryConsumer')

    expect(OptionalMemoryConsumer).toBeTypeOf('function')

    const dispatch = vi.fn().mockResolvedValue({ outcome: 'completed' })
    const absentMemory = new OptionalMemoryConsumer({
      workspaceBindingId: 'workspace-1',
      resolveProvider: () => undefined,
      authorize: () => false,
    })
    await expect(absentMemory.run({ text: 'Ordinary Harness request' }, dispatch)).resolves.toEqual(
      {
        outcome: { outcome: 'completed' },
        memory: { availability: 'absent', controls: [] },
      }
    )
    expect(dispatch).toHaveBeenCalledWith({ text: 'Ordinary Harness request' })

    const invoke = vi.fn(async (operation: string) =>
      operation === 'retrieve'
        ? { context: { entries: ['Authorized context'] } }
        : { accepted: true }
    )
    const providerFor = (contractId: string) => ({
      contract: { id: contractId, version: '1.0.0' },
      invoke,
    })
    const unauthorizedMemory = new OptionalMemoryConsumer({
      workspaceBindingId: 'workspace-1',
      resolveProvider: providerFor,
      authorize: () => false,
    })
    await unauthorizedMemory.run({ text: 'No grant' }, dispatch)
    await unauthorizedMemory.include({ turnId: 'turn-1' })
    expect(invoke).not.toHaveBeenCalled()
    expect(unauthorizedMemory.status()).toEqual({ availability: 'unauthorized', controls: [] })

    const authorizedMemory = new OptionalMemoryConsumer({
      workspaceBindingId: 'workspace-1',
      resolveProvider: providerFor,
      authorize: () => true,
    })
    const authorizedDispatch = vi.fn().mockResolvedValue({ outcome: 'completed' })
    await expect(authorizedMemory.run({ text: 'Use Memory' }, authorizedDispatch)).resolves.toEqual(
      {
        outcome: { outcome: 'completed' },
        memory: {
          availability: 'available',
          controls: ['retrieval', 'inclusion'],
        },
      }
    )
    expect(authorizedDispatch).toHaveBeenCalledWith({
      text: 'Use Memory',
      memoryContext: { entries: ['Authorized context'] },
    })
    await authorizedMemory.include({ turnId: 'turn-1' })
    expect(invoke).toHaveBeenNthCalledWith(1, 'retrieve', { text: 'Use Memory' })
    expect(invoke).toHaveBeenNthCalledWith(2, 'include', { turnId: 'turn-1' })
  })

  it('continues when Memory retrieval fails', async () => {
    const { OptionalMemoryConsumer } =
      await import('../../src/harness-execution/optional-memory.js')
    const cases = [
      {
        reason: 'rejected',
        invoke: vi.fn().mockRejectedValue(new Error('retrieval rejected')),
      },
      {
        reason: 'timeout',
        invoke: vi.fn(() => new Promise(() => {})),
      },
      {
        reason: 'disconnected',
        invoke: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error('socket closed'), { code: 'disconnected' })),
      },
    ]

    for (const failure of cases) {
      const projected: unknown[] = []
      const resolveProvider = vi.fn((contractId: string) => ({
        contract: { id: contractId, version: '1.0.0' },
        invoke: failure.invoke,
      }))
      const memory = new OptionalMemoryConsumer({
        workspaceBindingId: 'workspace-1',
        resolveProvider,
        authorize: () => true,
        timeoutMs: 5,
        projectStatus: (status: unknown) => projected.push(status),
      })
      const dispatch = vi.fn().mockResolvedValue({ outcome: 'completed' })

      await expect(memory.run({ text: 'Preserve exactly' }, dispatch)).resolves.toEqual({
        outcome: { outcome: 'completed' },
        memory: {
          availability: 'degraded',
          controls: ['retrieval', 'inclusion'],
          reason: failure.reason,
        },
      })
      expect(dispatch).toHaveBeenCalledWith({ text: 'Preserve exactly' })
      expect(failure.invoke).toHaveBeenCalledOnce()
      expect(
        resolveProvider.mock.calls.every(([id]) => id === 'memory.read' || id === 'memory.include')
      ).toBe(true)
      expect(projected).toEqual([memory.status()])
    }
  })
})

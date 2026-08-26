import { describe, expect, it, vi } from 'vitest'
import type { HarnessAdapter } from '../../src/harness-adapter/interface.js'
import type { StreamHandle } from '../../src/harness-adapter/types.js'
import { handleInterruption, queryOverlay } from '../../src/harness-adapter/capabilities.js'

describe('Harness capability degradation', () => {
  it('degrades interruption', async () => {
    const original = handle()
    const resumed = handle()
    const interrupt = vi.fn(async () => resumed)
    const supporting = adapter({ interruption: true, interrupt })
    const restart = vi.fn(async () => handle())

    await expect(
      handleInterruption(
        supporting,
        original,
        {
          spokenSoFar: 'I found',
          interruptionText: 'stop',
        },
        restart
      )
    ).resolves.toBe(resumed)
    expect(interrupt).toHaveBeenCalledOnce()
    expect(original.cancel).not.toHaveBeenCalled()
    expect(restart).not.toHaveBeenCalled()

    const unsupportedHandle = handle()
    const restarted = handle()
    const unsupportedRestart = vi.fn(async () => restarted)
    const unsupported = adapter({ interruption: false })
    await expect(
      handleInterruption(
        unsupported,
        unsupportedHandle,
        {
          spokenSoFar: 'I found',
          interruptionText: 'stop',
        },
        unsupportedRestart
      )
    ).resolves.toBe(restarted)
    expect(unsupportedHandle.cancel).toHaveBeenCalledOnce()
    expect(unsupportedRestart).toHaveBeenCalledOnce()
  })

  it('degrades overlay', async () => {
    const supporting = adapter({
      interruption: false,
      overlay: true,
      async overlayQuery(query) {
        return { content: `answer:${query}` }
      },
    })
    await expect(queryOverlay(supporting, 'where', {}, 20)).resolves.toEqual({
      content: 'answer:where',
    })

    await expect(queryOverlay(adapter({ interruption: false }), 'where', {}, 20)).rejects.toThrow(
      /does not support overlay/
    )

    const slow = adapter({
      interruption: false,
      overlay: true,
      overlayQuery() {
        return new Promise(() => {})
      },
    })
    await expect(queryOverlay(slow, 'where', {}, 5)).resolves.toEqual({ content: '' })
  })

  it('cancels slow overlay', async () => {
    vi.useFakeTimers()
    let observedSignal: AbortSignal | undefined
    const slow = adapter({
      interruption: false,
      overlay: true,
      overlayQuery(_query, context) {
        observedSignal = context.signal
        return new Promise((resolve) => {
          observedSignal?.addEventListener('abort', () => resolve({ content: '' }), { once: true })
        })
      },
    })

    try {
      const pending = queryOverlay(slow, 'where', {}, 3_000)
      await vi.advanceTimersByTimeAsync(3_000)
      await expect(pending).resolves.toEqual({ content: '' })
      expect(observedSignal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

function handle(): StreamHandle & { cancel: ReturnType<typeof vi.fn> } {
  return { cancel: vi.fn(), done: Promise.resolve() }
}

function adapter(
  overrides: Partial<HarnessAdapter> & {
    interruption: boolean
  }
): HarnessAdapter {
  return {
    id: 'test',
    capabilities: {
      structuredOutput: true,
      interruption: overrides.interruption,
      overlay: overrides.overlay ?? false,
      streaming: true,
    },
    async connect() {},
    async sendMessage() {
      return handle()
    },
    async disconnect() {},
    ...overrides,
  }
}

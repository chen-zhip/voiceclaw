import type { HarnessAdapter } from './interface.js'
import type { InterruptionContext, OverlayContext, OverlayResponse, StreamHandle } from './types.js'

export async function handleInterruption(
  adapter: HarnessAdapter,
  handle: StreamHandle,
  context: InterruptionContext,
  restart: () => Promise<StreamHandle>
): Promise<StreamHandle> {
  if (adapter.capabilities.interruption && adapter.interrupt) {
    return adapter.interrupt(handle, context)
  }
  handle.cancel()
  return restart()
}

export async function queryOverlay(
  adapter: HarnessAdapter,
  query: string,
  context: OverlayContext,
  timeoutMs = 3_000
): Promise<OverlayResponse> {
  if (!adapter.capabilities.overlay || !adapter.overlayQuery) {
    throw new Error(`Harness adapter ${adapter.id} does not support overlay queries`)
  }
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      adapter.overlayQuery(query, { ...context, signal: controller.signal }),
      new Promise<OverlayResponse>((resolve) => {
        timer = setTimeout(() => {
          controller.abort(new Error(`Overlay query timed out after ${timeoutMs} ms`))
          resolve({ content: '' })
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

import type { HarnessAdapter } from './interface.js'
import type { InterruptionContext, OverlayContext, OverlayResponse, StreamHandle } from './types.js'

export async function handleInterruption(
  adapter: HarnessAdapter,
  handle: StreamHandle,
  context: InterruptionContext
): Promise<StreamHandle> {
  if (adapter.capabilities.interruption && adapter.interrupt) {
    return adapter.interrupt(handle, context)
  }
  handle.cancel()
  throw new Error(
    'Harness interruption is unavailable. Resubmit the input explicitly, or select S2S Direct or S2S Operator.'
  )
}

export async function queryOverlay(
  adapter: HarnessAdapter,
  query: string,
  context: OverlayContext,
  timeoutMs = 3_000
): Promise<OverlayResponse> {
  if (!adapter.capabilities.overlay || !adapter.overlayQuery) {
    throw new Error(
      `Harness Integration Contract boundary ${adapter.id} does not support overlay queries. Resubmit the request through the main Harness flow, or explicitly select S2S Direct or S2S Operator.`
    )
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

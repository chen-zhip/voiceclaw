import type { HarnessAdapter } from './interface.js'

/**
 * Stands in for a Harness whose Turns are executed by a Desktop Host through
 * `harness.execution@1`. The session never sends Turns through it; it only
 * satisfies the composed adapter's construction and lifecycle.
 */
export function createHostRoutedHarnessAdapter(id: string): HarnessAdapter {
  return {
    id,
    capabilities: {
      structuredOutput: false,
      interruption: false,
      overlay: false,
      streaming: true,
    },
    async connect() {},
    async sendMessage() {
      throw new Error(`Harness ${id} is executed by the Desktop Host, not by a local adapter`)
    },
    async disconnect() {},
  }
}

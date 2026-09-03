import { ClaudeCodeAdapter, type HarnessTransport } from './claude-code-adapter.js'
import type { HarnessAdapter, HarnessCapabilities } from './interface.js'

export interface HarnessRegistryEntry {
  id: string
  available: boolean
  capabilities: HarnessCapabilities
}

export function listHarnessAdapters(): HarnessRegistryEntry[] {
  return entries.map((entry) => ({ ...entry, capabilities: { ...entry.capabilities } }))
}

export function createHarnessAdapter(id: string, transport?: HarnessTransport): HarnessAdapter {
  const entry = entries.find((candidate) => candidate.id === id)
  if (!entry) {
    throw new Error(
      `Unknown Harness Integration Contract boundary ${id}. Available IDs: ${entries.map((item) => item.id).join(', ')}`
    )
  }
  if (id !== 'claude-code' || !transport) {
    throw new Error(`Harness Integration Contract boundary ${id} is not available in this build`)
  }
  return new ClaudeCodeAdapter(transport)
}

const entries = [
  {
    id: 'claude-code',
    available: false,
    capabilities: {
      structuredOutput: true,
      interruption: true,
      overlay: true,
      streaming: true,
    },
  },
  {
    id: 'codex',
    available: false,
    capabilities: {
      structuredOutput: false,
      interruption: false,
      overlay: false,
      streaming: false,
    },
  },
  {
    id: 'cherry-studio',
    available: false,
    capabilities: {
      structuredOutput: false,
      interruption: false,
      overlay: false,
      streaming: false,
    },
  },
] satisfies readonly HarnessRegistryEntry[]

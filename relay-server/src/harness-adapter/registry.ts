import { ClaudeCodeAdapter, type HarnessTransport } from './claude-code-adapter.js'
import type { HarnessAdapter } from './interface.js'

export function listHarnessAdapters(): Array<{ id: string; available: boolean }> {
  return entries.map((entry) => ({ ...entry }))
}

export function createHarnessAdapter(id: string, transport?: HarnessTransport): HarnessAdapter {
  const entry = entries.find((candidate) => candidate.id === id)
  if (!entry) {
    throw new Error(
      `Unknown Harness adapter ${id}. Available IDs: ${entries.map((item) => item.id).join(', ')}`
    )
  }
  if (!entry.available) {
    throw new Error(`Harness adapter ${id} is not available in this build`)
  }
  if (!transport) {
    throw new Error('Claude Code Harness requires a configured transport')
  }
  return new ClaudeCodeAdapter(transport)
}

const entries = [
  { id: 'claude-code', available: true },
  { id: 'codex', available: false },
  { id: 'cherry-studio', available: false },
] as const

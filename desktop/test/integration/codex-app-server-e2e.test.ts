import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseHarnessExecutionStream } from '@voiceclaw/contracts'
import { codexExecutable, codexOptInReason, runRealCodexTurn } from './real-codex-app-server.js'
import { CODEX_APP_SERVER_SCHEMA_VERSION } from '../../src/main/providers/codex/app-server-schema.js'

const enabled = Boolean(codexExecutable)

if (!enabled) {
  console.info(`[codex-app-server-e2e] skipping: ${codexOptInReason}`)
}

describe(`Codex real app-server acceptance (opt-in: ${codexOptInReason})`, () => {
  it.skipIf(!enabled)(
    'executes a real app-server Turn through the production Codex Contribution',
    async () => {
      const workspacePath = await mkdtemp(join(tmpdir(), 'codex-app-server-workspace-'))
      try {
        const turn = await runRealCodexTurn({
          executable: codexExecutable as string,
          workspacePath,
        })

        expect(turn.version).toContain(CODEX_APP_SERVER_SCHEMA_VERSION)
        expect(turn.described).toMatchObject({ providerId: 'codex', profileStatus: 'exact' })
        expect(turn.threadId).toBeTypeOf('string')

        const events = turn.events
        expect(parseHarnessExecutionStream(events).success).toBe(true)
        expect(
          events.filter(
            (event) => event.kind === 'semantic-output' && event.payload.channel === 'speech'
          ).length
        ).toBeGreaterThan(0)
        expect(
          events.filter(
            (event) => event.kind === 'semantic-output' && event.payload.channel === 'screen'
          ).length
        ).toBeGreaterThan(0)
        expect(events.at(-1)).toMatchObject({
          kind: 'terminal',
          payload: { outcome: 'completed' },
        })
        expect(JSON.stringify(events)).not.toMatch(/reasoning|chain of thought/i)

        console.info('[codex-app-server-e2e] acceptance evidence', {
          codexVersion: turn.version,
          schemaVersion: CODEX_APP_SERVER_SCHEMA_VERSION,
          capabilityProfileVersion: turn.described.capabilityProfileVersion,
          terminalOutcome: events.at(-1)?.payload.outcome,
          publicSemanticOutputEvents: events.filter((event) => event.kind === 'semantic-output')
            .length,
        })
      } finally {
        await rm(workspacePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
      }
    },
    120_000
  )
})

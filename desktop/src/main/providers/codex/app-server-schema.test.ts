import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const artifactDirectory = resolve(
  process.cwd(),
  'src/main/providers/codex/app-server-schema/0.153.4'
)

describe('Codex app-server schema artifact', () => {
  it('rejects invalid consumed usage notifications', async () => {
    const { loadCodexAppServerSchema, createCodexMessageValidator } =
      await import('./app-server-schema.js')
    const validator = createCodexMessageValidator(loadCodexAppServerSchema(artifactDirectory))
    expect(
      validator.notification('thread/tokenUsage/updated', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        tokenUsage: { total: { inputTokens: -1, outputTokens: 1, totalTokens: 0 } },
      })
    ).toBe(false)
  })
  it('records the 0.153.4 generator and the committed fingerprint', async () => {
    const { loadCodexAppServerSchema } = await import('./app-server-schema.js')

    const artifact = loadCodexAppServerSchema(artifactDirectory)
    expect(artifact.generator).toEqual({ name: 'codex-cli', version: '0.153.4' })
    expect(artifact.sha256).toBe('9d4323a9cbd22361d688490c42044ff1d8dbc1fd6085c557768c3d9166eb689e')
  })

  it('validates the required protocol shapes without regenerating them', async () => {
    const { loadCodexAppServerSchema, validateCodexAppServerSchema } =
      await import('./app-server-schema.js')

    const artifact = loadCodexAppServerSchema(artifactDirectory)
    expect(validateCodexAppServerSchema(artifact)).toEqual({ valid: true, errors: [] })
    expect(Object.keys(artifact.shapes)).toEqual([
      'initialize',
      'thread',
      'turn',
      'item',
      'interruption',
      'terminal',
    ])
    expect(artifact.schemas['v2/TurnInterruptParams.json']).toMatchObject({
      title: 'TurnInterruptParams',
      required: ['threadId', 'turnId'],
    })
    expect(artifact.schemas['v2/AgentMessageDeltaNotification.json']).toMatchObject({
      title: 'AgentMessageDeltaNotification',
      required: ['delta', 'itemId', 'threadId', 'turnId'],
    })
  })

  it('fails closed when committed schema bytes change', async () => {
    const { loadCodexAppServerSchema } = await import('./app-server-schema.js')
    const tampered = await mkdtemp(join(tmpdir(), 'codex-schema-'))
    try {
      await cp(artifactDirectory, tampered, { recursive: true })
      const target = join(tampered, 'v2/TurnInterruptParams.json')
      const schema = JSON.parse(await readFile(target, 'utf8')) as {
        required: string[]
      }
      schema.required = ['threadId']
      await writeFile(target, JSON.stringify(schema, null, 2))

      expect(() => loadCodexAppServerSchema(tampered)).toThrowError(
        expect.objectContaining({ code: 'schema_integrity_mismatch' })
      )
    } finally {
      await rm(tampered, { recursive: true, force: true })
    }
  })

  it('reports missing required shapes instead of accepting the artifact', async () => {
    const { loadCodexAppServerSchema, validateCodexAppServerSchema } =
      await import('./app-server-schema.js')
    const artifact = loadCodexAppServerSchema(artifactDirectory)
    const { ['v2/TurnInterruptParams.json']: _removed, ...schemas } = artifact.schemas

    const result = validateCodexAppServerSchema({ ...artifact, schemas })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('interruption:v2/TurnInterruptParams.json:missing')
  })
})

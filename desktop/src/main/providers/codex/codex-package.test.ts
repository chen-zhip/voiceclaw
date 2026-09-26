import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HARNESS_EXECUTION_CONTRACT } from '@voiceclaw/contracts'

describe('Codex plugin package', () => {
  it('loads Codex without optional feature packages', async () => {
    const { codexPluginManifest } = await import('./codex-package.js')

    expect(codexPluginManifest.manifestVersion).toBe(0)
    expect(codexPluginManifest.id).toBe('voiceclaw-provider-codex')
    expect(codexPluginManifest.version).toBe('1.0.0')
    expect(codexPluginManifest.voiceclawVersionRange).toBe('>=0.1.0 <0.2.0')
    expect(codexPluginManifest.feature).toEqual({ id: 'codex', displayName: 'Codex' })
    expect(codexPluginManifest.lifecycle).toEqual({
      activation: 'startup',
      disable: 'restart-required',
      update: 'restart-required',
      uninstall: 'unsupported',
      dataDisposition: 'retain',
    })

    expect(codexPluginManifest.contributions.map((contribution) => contribution.id)).toEqual([
      'codex-provider',
      'codex-settings',
    ])
    const provider = codexPluginManifest.contributions[0]
    const settings = codexPluginManifest.contributions[1]
    expect(provider.type).toBe('provider-integration')
    expect(settings.type).toBe('client-ui')
    expect(provider.entry).toBe('codex-provider.ts')
    expect(settings.entry).toBe('codex-settings-metadata.ts')
    expect(provider.provides).toEqual([
      { id: HARNESS_EXECUTION_CONTRACT.id, version: HARNESS_EXECUTION_CONTRACT.version },
      { id: 'harness.capability-profile', version: '1.0.0' },
    ])
    expect(provider.requires).toEqual([])
    expect(provider.configSchema).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['workspacePath'],
      properties: {
        executablePath: { type: 'string' },
        workspacePath: { type: 'string' },
        model: { type: 'string' },
        approvalPolicy: { type: 'string', enum: ['ask', 'never'] },
        accountRef: { type: 'string' },
      },
    })
    expect(provider.requestedPermissions).toEqual([
      { id: 'process.spawn', scope: 'workspace' },
      { id: 'workspace.read-write', scope: 'workspace' },
      { id: 'secret.reference', scope: 'workspace' },
    ])
    expect(settings.provides).toEqual([{ id: 'provider.settings', version: '1.0.0' }])
    expect(settings.requires).toEqual([
      { id: HARNESS_EXECUTION_CONTRACT.id, range: `^${HARNESS_EXECUTION_CONTRACT.version}` },
    ])

    const requirements = codexPluginManifest.contributions.flatMap((contribution) =>
      contribution.requires.map((requirement) => requirement.id)
    )
    expect(requirements.filter((id) => /archive|memory/i.test(id))).toEqual([])
  })

  it('imports no Archive or Memory implementation', async () => {
    const directory = resolve(process.cwd(), 'src/main/providers/codex')
    const sources = (await readdir(directory)).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts')
    )
    const specifiers: string[] = []
    for (const source of sources) {
      const contents = await readFile(join(directory, source), 'utf8')
      for (const match of contents.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        specifiers.push(match[1])
      }
    }
    expect(specifiers.filter((specifier) => /archive|memory/i.test(specifier))).toEqual([])
  })
})

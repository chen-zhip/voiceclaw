import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function manifest(id: string, entry = 'entry.ts') {
  return {
    manifestVersion: 0,
    id,
    version: '1.0.0',
    voiceclawVersionRange: '>=0.1.0 <0.2.0',
    feature: { id: id.replace(/^voiceclaw-provider-/, ''), displayName: id },
    contributions: [
      {
        id: `${id}-provider`,
        type: 'provider-integration',
        runtime: 'desktop',
        entry,
        provides: [{ id: 'harness.execution', version: '1.0.0' }],
        requires: [],
        configSchema: { type: 'object' },
        requestedPermissions: [],
      },
    ],
    lifecycle: {
      activation: 'startup',
      disable: 'restart-required',
      update: 'restart-required',
      uninstall: 'unsupported',
      dataDisposition: 'retain',
    },
  }
}

async function writePackage(root: string, directory: string, value: unknown, entry?: string) {
  const packageRoot = join(root, directory)
  await mkdir(packageRoot, { recursive: true })
  await writeFile(join(packageRoot, 'voiceclaw.plugin.json'), JSON.stringify(value), 'utf8')
  if (entry)
    await writeFile(
      join(packageRoot, entry),
      'export const createProviderContribution = () => ({})',
      'utf8'
    )
  return packageRoot
}

describe('Desktop Host plugin discovery', () => {
  it('discovers valid packages with package-confined entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'host-plugins-'))
    const packageRoot = await writePackage(
      root,
      'voiceclaw-provider-codex',
      manifest('voiceclaw-provider-codex'),
      'entry.ts'
    )

    const { discoverHostPluginPackages } = await import('./host-plugin-discovery.js')
    const result = await discoverHostPluginPackages({ pluginRoots: [root] })

    expect(result.rejections).toEqual([])
    expect(result.packages).toEqual([
      {
        root: packageRoot,
        manifest: expect.objectContaining({ id: 'voiceclaw-provider-codex' }),
        entries: { 'voiceclaw-provider-codex-provider': resolve(packageRoot, 'entry.ts') },
      },
    ])
  })

  it('rejects invalid manifests and unreachable entries without failing the scan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'host-plugins-'))
    await writePackage(root, 'broken-manifest', { manifestVersion: 0, id: 'Broken' })
    await writePackage(root, 'missing-entry', manifest('voiceclaw-provider-missing'))
    await writePackage(root, 'good', manifest('voiceclaw-provider-good'), 'entry.ts')

    const { discoverHostPluginPackages } = await import('./host-plugin-discovery.js')
    const result = await discoverHostPluginPackages({ pluginRoots: [root] })

    expect(result.packages.map((pluginPackage) => pluginPackage.manifest.id)).toEqual([
      'voiceclaw-provider-good',
    ])
    expect(result.rejections.map((rejection) => rejection.errors[0].code).sort()).toEqual([
      'invalid_fields',
      'missing_entry',
    ])
  })

  it('rejects both packages when a manifest identity is duplicated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'host-plugins-'))
    await writePackage(root, 'first', manifest('voiceclaw-provider-dup'), 'entry.ts')
    await writePackage(root, 'second', manifest('voiceclaw-provider-dup'), 'entry.ts')

    const { discoverHostPluginPackages } = await import('./host-plugin-discovery.js')
    const result = await discoverHostPluginPackages({ pluginRoots: [root] })

    expect(result.packages).toEqual([])
    expect(result.rejections).toHaveLength(2)
    expect(
      result.rejections.every((rejection) => rejection.errors[0].code === 'duplicate_manifest_id')
    ).toBe(true)
  })

  it('treats a missing plugin root as empty', async () => {
    const { discoverHostPluginPackages } = await import('./host-plugin-discovery.js')

    const result = await discoverHostPluginPackages({
      pluginRoots: [join(tmpdir(), 'host-plugins-does-not-exist')],
    })

    expect(result).toEqual({ packages: [], rejections: [] })
  })
})

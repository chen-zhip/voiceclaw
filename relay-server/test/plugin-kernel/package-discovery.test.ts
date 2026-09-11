import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as discovery from '../../src/plugin-kernel/package-discovery.js'

function manifest(id: string, entry = 'dist/host.js') {
  return {
    manifestVersion: 0,
    id,
    version: '1.0.0',
    voiceclawVersionRange: '>=0.1.0 <0.2.0',
    feature: { id: id.replace('voiceclaw-', ''), displayName: id },
    contributions: [
      {
        id: 'host',
        type: 'desktop-service',
        runtime: 'desktop',
        entry,
        provides: [],
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

async function writePackage(root: string, id: string, complete = true, folder = id) {
  const packageRoot = join(root, folder)
  await mkdir(join(packageRoot, 'dist'), { recursive: true })
  await writeFile(join(packageRoot, 'voiceclaw.plugin.json'), JSON.stringify(manifest(id)))
  if (complete) await writeFile(join(packageRoot, 'dist', 'host.js'), 'export {}')
  return packageRoot
}

describe('Kernel package discovery', () => {
  it('discovers only complete packages in shipped and development-allowlisted roots', async () => {
    const discoverPluginPackages = (discovery as Record<string, unknown>).discoverPluginPackages as
      | ((options: {
          shippedRoots: string[]
          developmentAllowlistedRoots: string[]
          voiceclawVersion: string
        }) => Promise<{
          packages: Array<{ root: string; manifest: { id: string } }>
          rejections: Array<{ root: string; errors: Array<{ code: string }> }>
        }>)
      | undefined

    expect(typeof discoverPluginPackages).toBe('function')
    if (!discoverPluginPackages) return

    const base = await mkdtemp(join(tmpdir(), 'voiceclaw-discovery-'))
    const shipped = join(base, 'shipped')
    const development = join(base, 'development')
    const untrusted = join(base, 'untrusted')
    await Promise.all([mkdir(shipped), mkdir(development), mkdir(untrusted)])
    const shippedPackage = await writePackage(shipped, 'voiceclaw-shipped')
    const developmentPackage = await writePackage(development, 'voiceclaw-development')
    await writePackage(shipped, 'voiceclaw-incomplete', false)
    await writePackage(untrusted, 'voiceclaw-untrusted')

    const result = await discoverPluginPackages({
      shippedRoots: [shipped],
      developmentAllowlistedRoots: [development],
      voiceclawVersion: '0.1.0',
    })

    expect(result.packages.map((item) => item.root).sort()).toEqual(
      [developmentPackage, shippedPackage].sort()
    )
    expect(result.rejections).toEqual([
      expect.objectContaining({
        root: join(shipped, 'voiceclaw-incomplete'),
        errors: expect.arrayContaining([expect.objectContaining({ code: 'missing_entry' })]),
      }),
    ])
  })

  it('revalidates a secret-free Manifest projection in Relay', () => {
    const revalidateManifestProjection = (discovery as Record<string, unknown>)
      .revalidateManifestProjection as
      | ((input: unknown) => { success: boolean; data?: unknown })
      | undefined

    expect(typeof revalidateManifestProjection).toBe('function')
    if (!revalidateManifestProjection) return

    expect(revalidateManifestProjection(manifest('voiceclaw-safe')).success).toBe(true)
    expect(
      revalidateManifestProjection({
        ...manifest('voiceclaw-leaky'),
        packageRoot: 'C:/private/plugins/leaky',
        secret: 'credential-value',
      }).success
    ).toBe(false)
  })

  it('rejects duplicate Manifest identities across all discovery roots', async () => {
    const base = await mkdtemp(join(tmpdir(), 'voiceclaw-discovery-duplicates-'))
    const shipped = join(base, 'shipped')
    const development = join(base, 'development')
    await Promise.all([mkdir(shipped), mkdir(development)])
    await writePackage(shipped, 'voiceclaw-duplicate', true, 'shipped-copy')
    await writePackage(development, 'voiceclaw-duplicate', true, 'development-copy')

    const result = await discovery.discoverPluginPackages({
      shippedRoots: [shipped],
      developmentAllowlistedRoots: [development],
      voiceclawVersion: '0.1.0',
    })

    expect(result.packages).toEqual([])
    expect(result.rejections).toHaveLength(2)
    expect(
      result.rejections.every(({ errors }) => errors[0]?.code === 'duplicate_manifest_id')
    ).toBe(true)
  })
})

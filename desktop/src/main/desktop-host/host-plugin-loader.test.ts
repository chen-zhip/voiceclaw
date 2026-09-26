import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

function manifest(id: string, contributions: Array<Record<string, unknown>>) {
  return {
    manifestVersion: 0,
    id,
    version: '1.0.0',
    voiceclawVersionRange: '>=0.1.0 <0.2.0',
    feature: { id: 'codex', displayName: 'Codex' },
    contributions,
    lifecycle: {
      activation: 'startup',
      disable: 'restart-required',
      update: 'restart-required',
      uninstall: 'unsupported',
      dataDisposition: 'retain',
    },
  }
}

function providerContribution(id: string, entry: string) {
  return {
    id,
    type: 'provider-integration',
    runtime: 'desktop',
    entry,
    provides: [
      { id: 'harness.execution', version: '1.0.0' },
      { id: 'harness.capability-profile', version: '1.0.0' },
    ],
    requires: [],
    configSchema: { type: 'object' },
    requestedPermissions: [],
  }
}

async function writePackage(root: string, directory: string, value: unknown, files: string[]) {
  const packageRoot = join(root, directory)
  await mkdir(packageRoot, { recursive: true })
  await writeFile(join(packageRoot, 'voiceclaw.plugin.json'), JSON.stringify(value), 'utf8')
  for (const file of files) {
    await writeFile(
      join(packageRoot, file),
      'export const createProviderContribution = () => ({})',
      'utf8'
    )
  }
  return packageRoot
}

describe('Desktop Host Contribution loader', () => {
  it('loads only provider-integration contributions through package-confined entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'host-loader-'))
    const packageRoot = await writePackage(
      root,
      'voiceclaw-provider-codex',
      manifest('voiceclaw-provider-codex', [
        providerContribution('codex-provider', 'provider.ts'),
        { ...providerContribution('codex-settings', 'settings.ts'), type: 'client-ui' },
      ]),
      ['provider.ts', 'settings.ts']
    )
    const importModule = vi.fn(async (entryPath: string) => ({
      createProviderContribution: (context: Record<string, unknown>) => ({
        invoke: async () => ({ providerId: context.activeHostId }),
        readiness: {
          executable: 'detected',
          process: 'stopped',
          transport: 'disconnected',
          session: 'unavailable',
        },
      }),
    }))

    const { loadHostProviderContributions } = await import('./host-plugin-loader.js')
    const result = await loadHostProviderContributions({
      pluginRoots: [root],
      activeHostId: 'host-1',
      importModule,
    })

    expect(importModule).toHaveBeenCalledTimes(1)
    expect(importModule).toHaveBeenCalledWith(join(packageRoot, 'provider.ts'))
    expect(result.rejections).toEqual([])
    expect(result.contributions).toHaveLength(1)
    expect(result.contributions[0]).toMatchObject({
      packageId: 'voiceclaw-provider-codex',
      contributionId: 'codex-provider',
      registration: {
        category: 'provider-integration',
        providerId: 'codex',
        harnessVersion: '1.0.0',
        capabilityProfileVersion: '1.0.0',
        provides: [
          { id: 'harness.execution', version: '1.0.0' },
          { id: 'harness.capability-profile', version: '1.0.0' },
        ],
        requires: [],
        state: 'ACTIVE',
        readiness: {
          executable: 'detected',
          process: 'stopped',
          transport: 'disconnected',
          session: 'unavailable',
        },
      },
    })
    await expect(
      result.contributions[0].invoke({
        envelope: {} as never,
        payload: {},
      })
    ).resolves.toEqual({ providerId: 'host-1' })
  })

  it('passes the provider context supplied for the loaded package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'host-loader-'))
    await writePackage(
      root,
      'voiceclaw-provider-codex',
      manifest('voiceclaw-provider-codex', [providerContribution('codex-provider', 'provider.ts')]),
      ['provider.ts']
    )
    const seen: Array<Record<string, unknown>> = []
    const createProviderContext = vi.fn(async () => ({
      nativeConfiguration: { workspacePath: 'C:\\workspaces\\first' },
      boundary: { started: true },
    }))

    const { loadHostProviderContributions } = await import('./host-plugin-loader.js')
    await loadHostProviderContributions({
      pluginRoots: [root],
      activeHostId: 'host-1',
      importModule: async () => ({
        createProviderContribution: (context: Record<string, unknown>) => {
          seen.push(context)
          return { invoke: async () => ({}) }
        },
      }),
      createProviderContext,
    })

    expect(createProviderContext).toHaveBeenCalledTimes(1)
    expect(seen[0]).toMatchObject({
      activeHostId: 'host-1',
      manifest: expect.objectContaining({ id: 'voiceclaw-provider-codex' }),
      contribution: expect.objectContaining({ id: 'codex-provider' }),
      nativeConfiguration: { workspacePath: 'C:\\workspaces\\first' },
      boundary: { started: true },
    })
  })

  it('keeps loading other packages when one package fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'host-loader-'))
    await writePackage(
      root,
      'broken',
      manifest('voiceclaw-provider-broken', [
        providerContribution('broken-provider', 'provider.ts'),
      ]),
      ['provider.ts']
    )
    await writePackage(
      root,
      'good',
      manifest('voiceclaw-provider-good', [providerContribution('good-provider', 'provider.ts')]),
      ['provider.ts']
    )
    const importModule = vi.fn(async (entryPath: string) => {
      if (entryPath.includes('broken')) throw new Error('entry failed to load')
      return { createProviderContribution: () => ({ invoke: async () => ({ ok: true }) }) }
    })

    const { loadHostProviderContributions } = await import('./host-plugin-loader.js')
    const result = await loadHostProviderContributions({
      pluginRoots: [root],
      activeHostId: 'host-1',
      importModule,
    })

    expect(result.contributions.map((contribution) => contribution.packageId)).toEqual([
      'voiceclaw-provider-good',
    ])
    expect(result.rejections).toEqual([
      expect.objectContaining({
        packageId: 'voiceclaw-provider-broken',
        contributionId: 'broken-provider',
        code: 'entry_load_failed',
      }),
    ])
  })

  it('rejects a package whose entry does not export the factory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'host-loader-'))
    await writePackage(
      root,
      'voiceclaw-provider-noexport',
      manifest('voiceclaw-provider-noexport', [
        providerContribution('noexport-provider', 'provider.ts'),
      ]),
      ['provider.ts']
    )

    const { loadHostProviderContributions } = await import('./host-plugin-loader.js')
    const result = await loadHostProviderContributions({
      pluginRoots: [root],
      activeHostId: 'host-1',
      importModule: async () => ({}),
    })

    expect(result.contributions).toEqual([])
    expect(result.rejections).toEqual([
      expect.objectContaining({
        packageId: 'voiceclaw-provider-noexport',
        code: 'entry_contract_invalid',
      }),
    ])
  })
})

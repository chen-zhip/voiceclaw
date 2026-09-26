import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'

async function writeJavaScriptPackage(root: string) {
  const packageRoot = join(root, 'voiceclaw-provider-fixture')
  await mkdir(packageRoot, { recursive: true })
  await writeFile(
    join(packageRoot, 'voiceclaw.plugin.json'),
    JSON.stringify({
      manifestVersion: 0,
      id: 'voiceclaw-provider-fixture',
      version: '1.0.0',
      voiceclawVersionRange: '>=0.1.0 <0.2.0',
      feature: { id: 'codex', displayName: 'Codex' },
      contributions: [
        {
          id: 'fixture-provider',
          type: 'provider-integration',
          runtime: 'desktop',
          entry: 'provider.js',
          provides: [
            { id: 'harness.execution', version: '1.0.0' },
            { id: 'harness.capability-profile', version: '1.0.0' },
          ],
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
    }),
    'utf8'
  )
  await writeFile(
    join(packageRoot, 'provider.js'),
    [
      'export function createProviderContribution(context) {',
      '  return {',
      "    readiness: { executable: 'detected', process: 'stopped', transport: 'disconnected', session: 'unavailable' },",
      '    invoke: async () => ({ activeHostId: context.activeHostId }),',
      '  }',
      '}',
    ].join('\n'),
    'utf8'
  )
  return packageRoot
}

describe('Desktop Host plugin wiring', () => {
  it('reads plugin roots from the environment', async () => {
    const { resolveHostPluginRoots } = await import('./host-plugin-wiring.js')

    expect(resolveHostPluginRoots({})).toEqual([])
    expect(
      resolveHostPluginRoots({
        VOICECLAW_SHIPPED_PLUGIN_ROOTS: [` C:\\one `, '', `C:\\two`].join(delimiter),
      })
    ).toEqual(['C:\\one', 'C:\\two'])
  })

  it('registers nothing when no plugin root is configured', async () => {
    const { createHostContributionLoader } = await import('./host-plugin-wiring.js')

    const load = createHostContributionLoader({ environment: {}, activeHostId: 'host-1' })

    await expect(load()).resolves.toEqual([])
  })

  it('loads a provider package from a configured root with the default importer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'host-wiring-'))
    await writeJavaScriptPackage(root)
    const { createHostContributionLoader } = await import('./host-plugin-wiring.js')

    const load = createHostContributionLoader({
      environment: { VOICECLAW_SHIPPED_PLUGIN_ROOTS: root },
      activeHostId: 'host-1',
      createProviderContext: async () => ({ nativeConfiguration: {}, boundary: {} }),
    })
    const contributions = await load()

    expect(contributions).toHaveLength(1)
    expect(contributions[0]).toMatchObject({
      packageId: 'voiceclaw-provider-fixture',
      contributionId: 'fixture-provider',
      registration: {
        providerId: 'codex',
        harnessVersion: '1.0.0',
        capabilityProfileVersion: '1.0.0',
        state: 'ACTIVE',
      },
    })
    await expect(contributions[0].invoke({ envelope: {} as never, payload: {} })).resolves.toEqual({
      activeHostId: 'host-1',
    })
  })

  it('loads a shipped provider package without the TypeScript import fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'host-wiring-'))
    const packageRoot = join(root, 'voiceclaw-provider-codex')
    await mkdir(packageRoot, { recursive: true })
    await writeFile(
      join(packageRoot, 'voiceclaw.plugin.json'),
      JSON.stringify({
        manifestVersion: 0,
        id: 'voiceclaw-provider-codex',
        version: '1.0.0',
        voiceclawVersionRange: '>=0.1.0 <0.2.0',
        feature: { id: 'codex', displayName: 'Codex' },
        contributions: [
          {
            id: 'codex-provider',
            type: 'provider-integration',
            runtime: 'desktop',
            entry: 'codex-provider.ts',
            provides: [
              { id: 'harness.execution', version: '1.0.0' },
              { id: 'harness.capability-profile', version: '1.0.0' },
            ],
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
      }),
      'utf8'
    )
    await writeFile(join(packageRoot, 'codex-provider.ts'), 'export {}\n', 'utf8')
    const { createHostContributionLoader } = await import('./host-plugin-wiring.js')

    const load = createHostContributionLoader({
      environment: { VOICECLAW_SHIPPED_PLUGIN_ROOTS: root },
      activeHostId: 'host-1',
      importModule: async () => {
        throw new Error('the shipped package must not need the TypeScript import fallback')
      },
      createProviderContext: async () => ({
        nativeConfiguration: {
          bindingId: 'binding-1',
          workspaceBindingId: 'workspace-1',
          workspacePath: 'C:\\workspaces\\first',
          executablePath: 'C:\\tools\\codex.exe',
          preferences: { model: 'gpt-5-codex', approvalPolicy: 'never' },
          secretRefs: {},
        },
        boundary: {
          detectExecutable: async () => true,
          detectVersion: async () => 'codex-cli 0.153.4',
          start: async () => ({
            pid: 1,
            channel: { write: () => undefined, onData: () => undefined },
          }),
          terminate: async () => undefined,
        },
      }),
    })
    const contributions = await load()

    expect(contributions).toHaveLength(1)
    expect(contributions[0]).toMatchObject({
      packageId: 'voiceclaw-provider-codex',
      contributionId: 'codex-provider',
      registration: { providerId: 'codex', harnessVersion: '1.0.0' },
    })
    await expect(
      contributions[0].invoke({
        envelope: {
          operation: 'provider.describe',
          invocationId: 'invocation-1',
          selectedContribution: {
            packageId: 'voiceclaw-provider-codex',
            contributionId: 'codex-provider',
          },
        } as never,
        payload: {},
      })
    ).resolves.toMatchObject({ providerId: 'codex', profileStatus: 'exact' })
  })
})

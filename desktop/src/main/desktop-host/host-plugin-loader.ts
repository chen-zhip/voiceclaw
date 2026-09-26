import { basename } from 'node:path'
import type {
  KernelInvocationEnvelope,
  PluginContributionManifest,
  PluginManifestV0,
} from '@voiceclaw/contracts'
import type { DesktopHostContribution } from './host-contributions.js'
import { discoverHostPluginPackages } from './host-plugin-discovery.js'

export interface HostProviderContext {
  packageRoot: string
  manifest: PluginManifestV0
  contribution: PluginContributionManifest
  activeHostId: string
  nativeConfiguration: unknown
  boundary: unknown
}

export interface HostProviderEntry {
  invoke(input: {
    envelope: KernelInvocationEnvelope
    payload: Record<string, unknown>
  }): Promise<unknown>
  readiness?: NonNullable<DesktopHostContribution['registration']['readiness']>
  dispose?(): Promise<void>
}

export interface HostPluginLoadRejection {
  packageId: string
  contributionId: string
  code: 'package_rejected' | 'entry_load_failed' | 'entry_contract_invalid' | 'entry_factory_failed'
  message: string
}

// A loaded Contribution whose package has not reported provider readiness yet
// must not claim availability; the package supplies real readiness once it can.
const UNREPORTED_READINESS: NonNullable<DesktopHostContribution['registration']['readiness']> = {
  executable: 'missing',
  process: 'stopped',
  transport: 'disconnected',
  session: 'unavailable',
}

export interface HostPluginLoaderOptions {
  pluginRoots: string[]
  activeHostId: string
  importModule(entryPath: string): Promise<unknown>
  resolveEntry?(input: {
    packageId: string
    contributionId: string
    entryPath: string
  }): unknown | undefined
  createProviderContext?(input: {
    packageRoot: string
    manifest: PluginManifestV0
    contribution: PluginContributionManifest
    activeHostId: string
  }): Promise<{ nativeConfiguration?: unknown; boundary?: unknown }>
}

export async function loadHostProviderContributions(
  options: HostPluginLoaderOptions
): Promise<{ contributions: DesktopHostContribution[]; rejections: HostPluginLoadRejection[] }> {
  const discovery = await discoverHostPluginPackages({ pluginRoots: options.pluginRoots })
  const contributions: DesktopHostContribution[] = []
  const rejections: HostPluginLoadRejection[] = discovery.rejections.map((rejection) => ({
    packageId: basename(rejection.root),
    contributionId: '',
    code: 'package_rejected',
    message: rejection.errors.map((error) => `${error.path}:${error.code}`).join(', '),
  }))

  for (const pluginPackage of discovery.packages) {
    for (const contribution of pluginPackage.manifest.contributions) {
      if (contribution.type !== 'provider-integration') continue
      const rejection = { packageId: pluginPackage.manifest.id, contributionId: contribution.id }

      let module: unknown
      try {
        const bundledEntry = options.resolveEntry?.({
          packageId: pluginPackage.manifest.id,
          contributionId: contribution.id,
          entryPath: pluginPackage.entries[contribution.id],
        })
        module =
          bundledEntry === undefined
            ? await options.importModule(pluginPackage.entries[contribution.id])
            : await bundledEntry
      } catch (error) {
        rejections.push({
          ...rejection,
          code: 'entry_load_failed',
          message: detail(error),
        })
        continue
      }

      const factory = (module as { createProviderContribution?: unknown } | null)
        ?.createProviderContribution
      if (typeof factory !== 'function') {
        rejections.push({
          ...rejection,
          code: 'entry_contract_invalid',
          message: 'Provider entry must export createProviderContribution(context)',
        })
        continue
      }

      const provided = await options.createProviderContext?.({
        packageRoot: pluginPackage.root,
        manifest: pluginPackage.manifest,
        contribution,
        activeHostId: options.activeHostId,
      })
      const context: HostProviderContext = {
        packageRoot: pluginPackage.root,
        manifest: pluginPackage.manifest,
        contribution,
        activeHostId: options.activeHostId,
        nativeConfiguration: provided?.nativeConfiguration,
        boundary: provided?.boundary,
      }

      let entry: unknown
      try {
        entry = (factory as (input: HostProviderContext) => unknown)(context)
      } catch (error) {
        rejections.push({ ...rejection, code: 'entry_factory_failed', message: detail(error) })
        continue
      }

      const loaded = entry as HostProviderEntry | null
      if (!loaded || typeof loaded.invoke !== 'function') {
        rejections.push({
          ...rejection,
          code: 'entry_contract_invalid',
          message: 'Provider entry factory must return an invoke handler',
        })
        continue
      }

      contributions.push({
        packageId: pluginPackage.manifest.id,
        contributionId: contribution.id,
        registration: {
          category: 'provider-integration',
          providerId: pluginPackage.manifest.feature.id,
          harnessVersion:
            contribution.provides.find((contract) => contract.id === 'harness.execution')
              ?.version ?? '1.0.0',
          capabilityProfileVersion:
            contribution.provides.find((contract) => contract.id === 'harness.capability-profile')
              ?.version ?? '1.0.0',
          provides: contribution.provides.map((contract) => ({ ...contract })),
          requires: contribution.requires.map((requirement) => ({
            id: requirement.id,
            version: requirement.range,
          })),
          state: 'ACTIVE',
          readiness: loaded.readiness ?? { ...UNREPORTED_READINESS },
        },
        invoke: (input) => loaded.invoke(input),
        ...(loaded.dispose ? { dispose: () => loaded.dispose?.() as Promise<void> } : {}),
      })
    }
  }

  return { contributions, rejections }
}

export function createDesktopHostContributionLoader(
  options: HostPluginLoaderOptions
): () => Promise<DesktopHostContribution[]> {
  return async () => {
    const result = await loadHostProviderContributions(options)
    for (const rejection of result.rejections) {
      console.warn(
        `[desktop-host] skipped plugin contribution ${rejection.packageId}:${rejection.contributionId || '-'} (${rejection.code}): ${rejection.message}`
      )
    }
    return result.contributions
  }
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

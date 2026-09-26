import { delimiter } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createDesktopHostContributionLoader,
  type HostPluginLoaderOptions,
} from './host-plugin-loader.js'
import type { DesktopHostContribution } from './host-contributions.js'

export function resolveHostPluginRoots(environment: NodeJS.ProcessEnv): string[] {
  return (environment.VOICECLAW_SHIPPED_PLUGIN_ROOTS ?? '')
    .split(delimiter)
    .map((root) => root.trim())
    .filter((root) => root.length > 0)
}

export function createHostProviderEntryImporter(): (entryPath: string) => Promise<unknown> {
  return async (entryPath: string) => {
    if (/\.[cm]?tsx?$/.test(entryPath)) {
      // Dev-only path: TypeScript entries load through the repository toolchain
      // rather than being compiled into the Desktop bundle.
      const specifier = 'tsx/esm/api'
      let tsx: { register?: () => unknown }
      try {
        tsx = (await import(specifier)) as { register?: () => unknown }
      } catch {
        throw new Error(`TypeScript plugin entry ${entryPath} requires tsx to be installed`)
      }
      tsx.register?.()
    }
    return import(pathToFileURL(entryPath).href)
  }
}

export function createHostContributionLoader(options: {
  environment: NodeJS.ProcessEnv
  activeHostId: string
  importModule?: HostPluginLoaderOptions['importModule']
  createProviderContext?: HostPluginLoaderOptions['createProviderContext']
}): () => Promise<DesktopHostContribution[]> {
  return createDesktopHostContributionLoader({
    pluginRoots: resolveHostPluginRoots(options.environment),
    activeHostId: options.activeHostId,
    importModule: options.importModule ?? createHostProviderEntryImporter(),
    resolveEntry: (input) =>
      FIRST_PARTY_PROVIDER_ENTRIES[`${input.packageId}:${input.contributionId}`]?.(),
    ...(options.createProviderContext
      ? { createProviderContext: options.createProviderContext }
      : {}),
  })
}

// First-party packages ship with the Desktop bundle, so their entries are
// imported statically instead of through the runtime TypeScript loader.
const FIRST_PARTY_PROVIDER_ENTRIES: Record<string, () => Promise<unknown>> = {
  'voiceclaw-provider-codex:codex-provider': () => import('../providers/codex/codex-provider.js'),
}

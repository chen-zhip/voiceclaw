import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import {
  parsePluginManifest,
  type ManifestValidationError,
  type PluginManifestV0,
} from '@voiceclaw/contracts'

export interface DiscoveredHostPluginPackage {
  root: string
  manifest: PluginManifestV0
  entries: Record<string, string>
}

export interface RejectedHostPluginPackage {
  root: string
  errors: ManifestValidationError[]
}

export interface HostPluginDiscoveryResult {
  packages: DiscoveredHostPluginPackage[]
  rejections: RejectedHostPluginPackage[]
}

export async function discoverHostPluginPackages(options: {
  pluginRoots: string[]
}): Promise<HostPluginDiscoveryResult> {
  const packages: DiscoveredHostPluginPackage[] = []
  const rejections: RejectedHostPluginPackage[] = []
  const acceptedById = new Map<string, DiscoveredHostPluginPackage>()
  const duplicateIds = new Set<string>()

  // The Relay revalidates its own secret-free Manifest projection, so Desktop
  // only needs enough validation to load local entries safely.
  for (const pluginRoot of options.pluginRoots) {
    let directoryEntries
    try {
      directoryEntries = await readdir(pluginRoot, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of directoryEntries.sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      if (!entry.isDirectory()) continue
      const packageRoot = resolve(pluginRoot, entry.name)
      let input: unknown
      try {
        input = JSON.parse(await readFile(resolve(packageRoot, 'voiceclaw.plugin.json'), 'utf8'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        rejections.push({
          root: packageRoot,
          errors: [errorResult('invalid_manifest_json', 'Manifest is not valid JSON')],
        })
        continue
      }

      const parsed = parsePluginManifest(input)
      if (!parsed.success) {
        rejections.push({ root: packageRoot, errors: parsed.errors })
        continue
      }

      const entries = await resolvePackageEntries(packageRoot, parsed.data)
      if (typeof entries === 'string') {
        rejections.push({
          root: packageRoot,
          errors: [errorResult(entries, 'Contribution entry is missing or outside the package')],
        })
        continue
      }

      const discovered = { root: packageRoot, manifest: parsed.data, entries }
      const existing = acceptedById.get(parsed.data.id)
      if (existing || duplicateIds.has(parsed.data.id)) {
        const duplicateError = errorResult(
          'duplicate_manifest_id',
          'Plugin Manifest identity must be globally unique'
        )
        if (existing) {
          acceptedById.delete(parsed.data.id)
          const index = packages.indexOf(existing)
          if (index >= 0) packages.splice(index, 1)
          rejections.push({ root: existing.root, errors: [duplicateError] })
        }
        duplicateIds.add(parsed.data.id)
        rejections.push({ root: packageRoot, errors: [duplicateError] })
        continue
      }
      packages.push(discovered)
      acceptedById.set(parsed.data.id, discovered)
    }
  }

  return { packages, rejections }
}

async function resolvePackageEntries(
  packageRoot: string,
  manifest: PluginManifestV0
): Promise<Record<string, string> | string> {
  const canonicalRoot = await realpath(packageRoot)
  const entries: Record<string, string> = {}
  for (const contribution of manifest.contributions) {
    const entryPath = resolve(packageRoot, contribution.entry)
    try {
      const [entryStat, canonicalEntry] = await Promise.all([stat(entryPath), realpath(entryPath)])
      const relativeEntry = relative(canonicalRoot, canonicalEntry)
      if (
        !entryStat.isFile() ||
        relativeEntry.startsWith('..') ||
        resolve(canonicalRoot, relativeEntry) !== canonicalEntry
      ) {
        return 'missing_entry'
      }
    } catch {
      return 'missing_entry'
    }
    entries[contribution.id] = entryPath
  }
  return entries
}

function errorResult(code: string, message: string): ManifestValidationError {
  return { path: code, code, message }
}

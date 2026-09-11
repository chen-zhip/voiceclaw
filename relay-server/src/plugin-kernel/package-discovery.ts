import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import {
  parsePluginManifest,
  type ManifestValidationError,
  type ManifestValidationResult,
  type PluginManifestV0,
} from '@voiceclaw/contracts'
import { versionSatisfies } from './semver.js'

export interface DiscoveredPluginPackage {
  root: string
  manifest: PluginManifestV0
}

export interface RejectedPluginPackage {
  root: string
  errors: ManifestValidationError[]
}

export interface PackageDiscoveryResult {
  packages: DiscoveredPluginPackage[]
  rejections: RejectedPluginPackage[]
}

export interface PackageDiscoveryOptions {
  shippedRoots: string[]
  developmentAllowlistedRoots: string[]
  voiceclawVersion: string
}

export function revalidateManifestProjection(input: unknown): ManifestValidationResult {
  return parsePluginManifest(input)
}

export async function discoverPluginPackages(
  options: PackageDiscoveryOptions
): Promise<PackageDiscoveryResult> {
  const packages: DiscoveredPluginPackage[] = []
  const rejections: RejectedPluginPackage[] = []
  const acceptedByManifestId = new Map<string, DiscoveredPluginPackage>()
  const duplicateManifestIds = new Set<string>()
  const allowedRoots = [
    ...new Set([...options.shippedRoots, ...options.developmentAllowlistedRoots]),
  ]

  for (const allowedRoot of allowedRoots) {
    let entries
    try {
      entries = await readdir(allowedRoot, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) continue
      const packageRoot = resolve(allowedRoot, entry.name)
      const manifestPath = resolve(packageRoot, 'voiceclaw.plugin.json')
      let input: unknown
      try {
        input = JSON.parse(await readFile(manifestPath, 'utf8'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        rejections.push({
          root: packageRoot,
          errors: [errorResult('invalid_manifest_json', 'Manifest is not valid JSON')],
        })
        continue
      }

      const parsed = revalidateManifestProjection(input)
      if (!parsed.success) {
        rejections.push({ root: packageRoot, errors: parsed.errors })
        continue
      }
      if (!versionSatisfies(options.voiceclawVersion, parsed.data.voiceclawVersionRange)) {
        rejections.push({
          root: packageRoot,
          errors: [
            errorResult(
              'incompatible_voiceclaw_version',
              'Package is incompatible with this VoiceClaw version'
            ),
          ],
        })
        continue
      }

      const entryErrors = await validatePackageEntries(packageRoot, parsed.data)
      if (entryErrors.length > 0) {
        rejections.push({ root: packageRoot, errors: entryErrors })
        continue
      }
      const discovered = { root: packageRoot, manifest: parsed.data }
      const existing = acceptedByManifestId.get(parsed.data.id)
      if (existing || duplicateManifestIds.has(parsed.data.id)) {
        const duplicateError = errorResult(
          'duplicate_manifest_id',
          'Plugin Manifest identity must be globally unique'
        )
        if (existing) {
          acceptedByManifestId.delete(parsed.data.id)
          const index = packages.indexOf(existing)
          if (index >= 0) packages.splice(index, 1)
          rejections.push({ root: existing.root, errors: [duplicateError] })
        }
        duplicateManifestIds.add(parsed.data.id)
        rejections.push({ root: packageRoot, errors: [duplicateError] })
        continue
      }
      packages.push(discovered)
      acceptedByManifestId.set(parsed.data.id, discovered)
    }
  }

  return { packages, rejections }
}

async function validatePackageEntries(
  packageRoot: string,
  manifest: PluginManifestV0
): Promise<ManifestValidationError[]> {
  const errors: ManifestValidationError[] = []
  const canonicalRoot = await realpath(packageRoot)
  for (const [index, contribution] of manifest.contributions.entries()) {
    const entryPath = resolve(packageRoot, contribution.entry)
    try {
      const [entryStat, canonicalEntry] = await Promise.all([stat(entryPath), realpath(entryPath)])
      const relativeEntry = relative(canonicalRoot, canonicalEntry)
      if (
        !entryStat.isFile() ||
        relativeEntry.startsWith('..') ||
        resolve(canonicalRoot, relativeEntry) !== canonicalEntry
      ) {
        throw new Error('Entry is not a package-confined file')
      }
    } catch {
      errors.push({
        path: `contributions.${index}.entry`,
        code: 'missing_entry',
        message: 'Contribution entry is missing or outside the package',
      })
    }
  }
  return errors
}

function errorResult(code: string, message: string): ManifestValidationError {
  return { path: '$', code, message }
}

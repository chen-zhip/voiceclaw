import { createCodexProcessBoundary } from '../providers/codex/codex-process-boundary.js'
import { createSimulatedCodexBoundary } from '../providers/codex/codex-simulation-boundary.js'
import type { HostPluginLoaderOptions } from './host-plugin-loader.js'

export interface NativeProviderBindingSummary {
  bindingId: string
  providerId: string
  workspaceBindingId: string
}

interface BindingStorage {
  list(prefix: string): Promise<string[]>
  get(key: string): Promise<string | undefined>
}

const STORAGE_PREFIX = 'desktop-host:native-provider-configuration:'

export async function listNativeProviderBindings(
  storage: BindingStorage
): Promise<NativeProviderBindingSummary[]> {
  const summaries: NativeProviderBindingSummary[] = []
  for (const key of await storage.list(STORAGE_PREFIX)) {
    const configuration = await readConfiguration(storage, key)
    if (!configuration) continue
    summaries.push({
      bindingId: configuration.bindingId,
      providerId: configuration.providerId,
      workspaceBindingId: configuration.workspaceBindingId,
    })
  }
  return summaries.sort((left, right) =>
    left.bindingId < right.bindingId ? -1 : left.bindingId > right.bindingId ? 1 : 0
  )
}

export function createHostProviderContextFactory(options: {
  storage: BindingStorage
  bindingId?: string
  createBoundary?: (providerId: string, configuration: NativeProviderConfiguration) => unknown
}): NonNullable<HostPluginLoaderOptions['createProviderContext']> {
  const createBoundary = options.createBoundary ?? defaultCreateBoundary
  return async () => {
    const selected =
      options.bindingId === undefined
        ? (await listNativeProviderBindings(options.storage))[0]
        : (await listNativeProviderBindings(options.storage)).find(
            (binding) => binding.bindingId === options.bindingId
          )
    if (!selected) return {}
    const configuration = await readConfiguration(
      options.storage,
      `${STORAGE_PREFIX}${selected.bindingId}`
    )
    if (!configuration) return {}
    return {
      nativeConfiguration: toPackageConfiguration(configuration),
      boundary: createBoundary(configuration.providerId, configuration),
    }
  }
}

export async function reportConfiguredBindingReadiness(input: {
  storage: BindingStorage
  report(binding: NativeProviderBindingSummary): Promise<void>
}): Promise<number> {
  const bindings = await listNativeProviderBindings(input.storage)
  for (const binding of bindings) await input.report(binding)
  return bindings.length
}

export async function listLocalBindingHandoff(
  storage: BindingStorage
): Promise<
  Array<NativeProviderBindingSummary & { workspacePath?: string; executablePath?: string }>
> {
  const handoff: Array<
    NativeProviderBindingSummary & { workspacePath?: string; executablePath?: string }
  > = []
  for (const binding of await listNativeProviderBindings(storage)) {
    const configuration = await readConfiguration(storage, `${STORAGE_PREFIX}${binding.bindingId}`)
    handoff.push({
      ...binding,
      ...(configuration?.workspacePath ? { workspacePath: configuration.workspacePath } : {}),
      ...(configuration?.executable?.path ? { executablePath: configuration.executable.path } : {}),
    })
  }
  return handoff
}

// The stored Native Provider Configuration is the Host's machine-specific
// record; a package validates what its own Configuration Schema declares.
function toPackageConfiguration(configuration: NativeProviderConfiguration) {
  return {
    bindingId: configuration.bindingId,
    workspaceBindingId: configuration.workspaceBindingId,
    workspacePath: configuration.workspacePath,
    executablePath: configuration.executable.path,
    preferences: { ...configuration.preferences },
    secretRefs: { ...configuration.secretRefs },
  }
}

export interface NativeProviderConfiguration {
  providerId: string
  bindingId: string
  workspaceBindingId: string
  workspacePath: string
  executable: { path: string; args: string[] }
  preferences: Record<string, unknown>
  secretRefs: Record<string, string>
}

async function readConfiguration(
  storage: BindingStorage,
  key: string
): Promise<NativeProviderConfiguration | undefined> {
  const raw = await storage.get(key)
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as Partial<NativeProviderConfiguration>
    if (
      typeof parsed.bindingId !== 'string' ||
      typeof parsed.providerId !== 'string' ||
      typeof parsed.workspaceBindingId !== 'string' ||
      typeof parsed.workspacePath !== 'string'
    ) {
      return undefined
    }
    return {
      providerId: parsed.providerId,
      bindingId: parsed.bindingId,
      workspaceBindingId: parsed.workspaceBindingId,
      workspacePath: parsed.workspacePath,
      executable: parsed.executable ?? { path: 'codex', args: ['app-server'] },
      preferences: parsed.preferences ?? {},
      secretRefs: parsed.secretRefs ?? {},
    }
  } catch {
    return undefined
  }
}

// Provider-native knowledge stays in first-party modules: only the providers the
// Host ships a boundary for can be loaded, and anything else loads without one.
function defaultCreateBoundary(providerId: string): unknown {
  if (providerId === 'codex') {
    if (process.env.VOICECLAW_CODEX_SIMULATED === 'true') return createSimulatedCodexBoundary()
    return createCodexProcessBoundary({ environment: process.env })
  }
  return undefined
}

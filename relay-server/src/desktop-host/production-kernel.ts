import { delimiter } from 'node:path'
import type { ControlStateStore } from '../plugin-kernel/control-state-store.js'
import { PhaseZeroKernel, type HostTransport } from '../plugin-kernel/phase-zero-kernel.js'
import { localProviderConfigurations } from './local-profile.js'

export async function bootstrapProductionHostKernel(
  environment: NodeJS.ProcessEnv,
  controlStatePath: string,
  controlState: ControlStateStore,
  hostTransport?: HostTransport
): Promise<PhaseZeroKernel | undefined> {
  const roots =
    environment.VOICECLAW_SHIPPED_PLUGIN_ROOTS?.split(delimiter)
      .map((root) => root.trim())
      .filter(Boolean) ?? []
  const packageId = environment.VOICECLAW_HARNESS_PACKAGE_ID?.trim()
  const contributionId = environment.VOICECLAW_HARNESS_CONTRIBUTION_ID?.trim()
  if (roots.length === 0 || !packageId || !contributionId) return undefined

  return PhaseZeroKernel.bootstrap({
    shippedRoots: roots,
    developmentAllowlistedRoots: [],
    voiceclawVersion: environment.VOICECLAW_VERSION?.trim() || '0.1.0',
    controlStatePath,
    controlState,
    ...(hostTransport ? { hostTransport } : {}),
    selectedProviders: {
      'harness.execution': { packageId, contributionId },
    },
    configurations: localProviderConfigurations(environment),
    grants: [...controlState.read().grants],
    assignments: [...controlState.read().assignments],
    // Only reached when no Host transport is wired: fail closed with an
    // actionable message instead of dispatching anywhere else.
    loadContribution: async () => ({
      invoke: async () => {
        throw new Error(
          'No Desktop Host transport is connected; connect a Desktop Host for this Harness binding'
        )
      },
    }),
  })
}

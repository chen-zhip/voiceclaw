import { delimiter } from 'node:path'
import type { ControlStateStore } from '../plugin-kernel/control-state-store.js'
import { PhaseZeroKernel } from '../plugin-kernel/phase-zero-kernel.js'

export async function bootstrapProductionHostKernel(
  environment: NodeJS.ProcessEnv,
  controlStatePath: string,
  controlState: ControlStateStore
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
    selectedProviders: {
      'harness.execution': { packageId, contributionId },
    },
    configurations: {},
    grants: [...controlState.read().grants],
    assignments: [...controlState.read().assignments],
    loadContribution: async () => ({
      invoke: async () => {
        throw new Error('desktop_host_transport_required')
      },
    }),
  })
}

import type { ControlStateStore } from '../plugin-kernel/control-state-store.js'

export interface LocalBindingIdentity {
  bindingId: string
  providerId: string
  workspaceBindingId: string
  workspacePath?: string
}

const HARNESS_OPERATIONS = [
  'provider.describe',
  'thread.ensure',
  'turn.start',
  'turn.cancel',
] as const

export function declaredLocalBindings(environment: NodeJS.ProcessEnv): LocalBindingIdentity[] {
  return parseDeclaredBindings(environment).map(
    ({ bindingId, providerId, workspaceBindingId }) => ({
      bindingId,
      providerId,
      workspaceBindingId,
    })
  )
}

/**
 * The packaged Provider validates its own declared Configuration Schema, so the
 * Relay Kernel needs those non-secret fields (never secret references) to accept
 * the Contribution at all.
 */
export function localProviderConfigurations(
  environment: NodeJS.ProcessEnv
): Record<string, Record<string, unknown>> {
  const packageId = environment.VOICECLAW_HARNESS_PACKAGE_ID?.trim()
  const contributionId = environment.VOICECLAW_HARNESS_CONTRIBUTION_ID?.trim()
  if (!packageId || !contributionId) return {}
  const configured = parseDeclaredBindings(environment).find(
    (binding) => typeof binding.workspacePath === 'string' && binding.workspacePath.length > 0
  )
  if (!configured?.workspacePath) return {}
  return { [`${packageId}:${contributionId}`]: { workspacePath: configured.workspacePath } }
}

function parseDeclaredBindings(environment: NodeJS.ProcessEnv): LocalBindingIdentity[] {
  const raw = environment.VOICECLAW_LOCAL_BINDINGS?.trim()
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter(isBindingIdentity).map((binding) => {
    const workspacePath = (binding as { workspacePath?: unknown }).workspacePath
    return {
      bindingId: binding.bindingId,
      providerId: binding.providerId,
      workspaceBindingId: binding.workspaceBindingId,
      ...(typeof workspacePath === 'string' && workspacePath.length > 0 ? { workspacePath } : {}),
    }
  })
}

/**
 * The Desktop-owned local stack declares its Host-local bindings when it launches
 * the bundled Relay. That declaration is what lets the Relay authorize the Host's
 * Contribution registration and route Harness Turns without a cloud control plane.
 */
export async function seedLocalProfile(input: {
  store: ControlStateStore
  environment: NodeJS.ProcessEnv
}): Promise<{ grants: number; assignments: number }> {
  const bindings = declaredLocalBindings(input.environment)
  const hostId = input.environment.VOICECLAW_LOCAL_HOST_ID?.trim()
  if (bindings.length === 0 || !hostId) {
    console.log(
      `[local-profile] no local binding profile to seed (declared=${bindings.length}, hostId=${hostId ? 'present' : 'missing'})`
    )
    return { grants: 0, assignments: 0 }
  }

  let grantsAdded = 0
  let assignmentsTouched = 0
  await input.store.commit((state) => {
    const grants = [...state.grants]
    const assignments = [...state.assignments]
    for (const binding of bindings) {
      for (const operation of HARNESS_OPERATIONS) {
        const id = `grant-routing-harness-execution-${binding.workspaceBindingId}-${operation}`
        if (grants.some((grant) => grant.id === id)) continue
        grants.push({
          id,
          principalId: 'routing',
          contractId: 'harness.execution',
          operation,
          scope: { kind: 'workspace', id: binding.workspaceBindingId },
          secretRefs: [],
          workspaceBindings: [binding.workspaceBindingId],
          revoked: false,
        })
        grantsAdded += 1
      }

      const index = assignments.findIndex((candidate) => candidate.bindingId === binding.bindingId)
      if (index < 0) {
        assignments.push({
          bindingId: binding.bindingId,
          hostId,
          providerId: binding.providerId,
          workspaceBindingId: binding.workspaceBindingId,
          generation: 1,
        })
        assignmentsTouched += 1
        continue
      }
      const existing = assignments[index]
      if (
        existing.hostId === hostId &&
        existing.providerId === binding.providerId &&
        existing.workspaceBindingId === binding.workspaceBindingId
      ) {
        continue
      }
      assignments[index] = {
        bindingId: binding.bindingId,
        hostId,
        providerId: binding.providerId,
        workspaceBindingId: binding.workspaceBindingId,
        generation: existing.generation + 1,
      }
      assignmentsTouched += 1
    }
    return { ...state, grants, assignments }
  })

  console.log(
    `[local-profile] seeded ${grantsAdded} grant(s) and ${assignmentsTouched} assignment(s) for ${bindings.length} declared binding(s)`
  )
  return { grants: grantsAdded, assignments: assignmentsTouched }
}

function isBindingIdentity(value: unknown): value is LocalBindingIdentity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const binding = value as Record<string, unknown>
  return (
    typeof binding.bindingId === 'string' &&
    binding.bindingId.length > 0 &&
    typeof binding.providerId === 'string' &&
    binding.providerId.length > 0 &&
    typeof binding.workspaceBindingId === 'string' &&
    binding.workspaceBindingId.length > 0
  )
}

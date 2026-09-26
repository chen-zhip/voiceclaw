import { resolveSessionMode, resolveVoiceMode } from '../types.js'

export interface HarnessBindingSelection {
  bindingId: string
  providerId: string
  workspaceBindingId: string
}

interface PipelineSelectionConfig {
  mode?: unknown
  voiceMode?: unknown
  harnessBinding?: Partial<HarnessBindingSelection>
}

interface AssignmentProjection extends HarnessBindingSelection {
  hostId: string
  generation: number
  status: 'ready' | 'unready' | 'offline'
}

interface AssignmentReader {
  inspect(bindingId: string): AssignmentProjection
}

const recovery = ['retry', 'reselect-provider', 'return-to-s2s'] as const

export function selectConversationPipeline(
  config: PipelineSelectionConfig,
  input: Record<string, unknown>,
  assignments: AssignmentReader
) {
  const preservedInput = structuredClone(input)
  if (resolveSessionMode(config.mode) !== 'stt-tts') {
    return {
      accepted: true as const,
      pipeline:
        resolveVoiceMode(config.voiceMode) === 'operator'
          ? ('s2s-operator' as const)
          : ('s2s-direct' as const),
      input: preservedInput,
    }
  }

  const selection = config.harnessBinding
  if (
    !isNonempty(selection?.bindingId) ||
    !isNonempty(selection.providerId) ||
    !isNonempty(selection.workspaceBindingId)
  ) {
    return unavailable('selection-required', preservedInput)
  }

  try {
    const assignment = assignments.inspect(selection.bindingId)
    if (
      assignment.status !== 'ready' ||
      assignment.providerId !== selection.providerId ||
      assignment.workspaceBindingId !== selection.workspaceBindingId
    ) {
      return unavailable('binding-unavailable', preservedInput)
    }
    const { status: _, ...binding } = assignment
    return {
      accepted: true as const,
      pipeline: 'stt-tts-harness' as const,
      binding,
      input: preservedInput,
    }
  } catch {
    return unavailable('binding-unavailable', preservedInput)
  }
}

function unavailable(
  reason: 'selection-required' | 'binding-unavailable',
  input: Record<string, unknown>
) {
  return {
    accepted: false as const,
    pipeline: 'stt-tts-harness' as const,
    reason,
    input,
    recovery: [...recovery],
  }
}

function isNonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

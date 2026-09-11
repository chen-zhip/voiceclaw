export type PublicOutputClass =
  | 'semantic-output'
  | 'presentation-state'
  | 'outcome-evidence'
  | 'diagnostic'

export type OutputBoundaryResult =
  | { accepted: true }
  | {
      accepted: false
      code: 'private_reasoning_forbidden' | 'invalid_output_class' | 'model_inference_not_granted'
    }

const PUBLIC_OUTPUT_CLASSES = new Set<PublicOutputClass>([
  'semantic-output',
  'presentation-state',
  'outcome-evidence',
  'diagnostic',
])

export function validateHostRpcOutput(input: unknown): OutputBoundaryResult {
  if (containsPrivateReasoning(input)) {
    return { accepted: false, code: 'private_reasoning_forbidden' }
  }
  if (
    !isExactRecord(input, ['class', 'content']) ||
    !PUBLIC_OUTPUT_CLASSES.has(input.class as PublicOutputClass)
  ) {
    return { accepted: false, code: 'invalid_output_class' }
  }
  return { accepted: true }
}

export function acceptModelInferenceOutput(
  input: {
    principalId: string
    scope: unknown
    output: unknown
  },
  authorize: (request: Record<string, unknown>) => { authorized: boolean }
): { accepted: true; output: unknown } | { accepted: false; code: string } {
  const authorization = authorize({
    principalId: input.principalId,
    contractId: 'model.inference',
    operation: 'infer',
    scope: input.scope,
  })
  if (!authorization.authorized) {
    return { accepted: false, code: 'model_inference_not_granted' }
  }
  const validation = validateHostRpcOutput(input.output)
  if (!validation.accepted) return validation
  return { accepted: true, output: structuredClone(input.output) }
}

function containsPrivateReasoning(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPrivateReasoning)
  if (typeof value !== 'object' || value === null) return false
  return Object.entries(value).some(
    ([key, child]) =>
      /^(?:private[-_ ]?reasoning|chain[-_ ]?of[-_ ]?thought|raw[-_ ]?reasoning)$/i.test(key) ||
      (key === 'class' && child === 'private-reasoning') ||
      containsPrivateReasoning(child)
  )
}

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

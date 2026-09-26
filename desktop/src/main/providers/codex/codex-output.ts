export const CODEX_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['speech', 'text'],
  properties: {
    speech: {
      type: 'object',
      additionalProperties: false,
      required: ['content'],
      properties: {
        content: { type: 'string' },
      },
    },
    text: {
      type: 'object',
      additionalProperties: false,
      required: ['content'],
      properties: {
        content: { type: 'string' },
      },
    },
  },
} as const

export type ParsedCodexCompletion =
  | { valid: true; speechText: string; screenText: string }
  | { valid: false; fallbackText: string; code: 'invalid-json' | 'invalid-shape' }

export function parseCodexCompletion(raw: string): ParsedCodexCompletion {
  const fallbackText = raw.trim()
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { valid: false, fallbackText, code: 'invalid-json' }
  }
  if (!isRecord(value) || !hasOnlyKeys(value, ['thinking', 'speech', 'text'])) {
    return { valid: false, fallbackText, code: 'invalid-shape' }
  }

  const speech = value.speech
  if (
    !isRecord(speech) ||
    !hasOnlyKeys(speech, ['content', 'emotion', 'speed', 'screenReferences'])
  ) {
    return { valid: false, fallbackText, code: 'invalid-shape' }
  }
  if (typeof speech.content !== 'string') {
    return { valid: false, fallbackText, code: 'invalid-shape' }
  }
  if (speech.emotion !== undefined && typeof speech.emotion !== 'string') {
    return { valid: false, fallbackText, code: 'invalid-shape' }
  }
  if (speech.speed !== undefined && !isFiniteNumber(speech.speed)) {
    return { valid: false, fallbackText, code: 'invalid-shape' }
  }
  if (speech.screenReferences !== undefined && !validScreenReferences(speech.screenReferences)) {
    return { valid: false, fallbackText, code: 'invalid-shape' }
  }

  if (value.thinking !== undefined && !validThinking(value.thinking)) {
    return { valid: false, fallbackText, code: 'invalid-shape' }
  }

  if (value.text !== undefined && !validText(value.text)) {
    return { valid: false, fallbackText, code: 'invalid-shape' }
  }
  if (!speech.content.trim() && value.text === undefined) {
    return { valid: false, fallbackText, code: 'invalid-shape' }
  }
  const screenText = isRecord(value.text) ? value.text.content : speech.content
  return { valid: true, speechText: speech.content, screenText }
}

function validThinking(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ['steps', 'reasoning', 'confidence'])) return false
  return (
    Array.isArray(value.steps) &&
    value.steps.every((step) => typeof step === 'string') &&
    typeof value.reasoning === 'string' &&
    (value.confidence === undefined ||
      (isFiniteNumber(value.confidence) && value.confidence >= 0 && value.confidence <= 1))
  )
}

function validText(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ['content', 'format', 'language', 'sections']))
    return false
  if (typeof value.content !== 'string' || value.content.trim().length === 0) return false
  if (
    value.format !== undefined &&
    value.format !== 'markdown' &&
    value.format !== 'plain' &&
    value.format !== 'code'
  ) {
    return false
  }
  if (value.language !== undefined && typeof value.language !== 'string') return false
  if (value.sections === undefined) return true
  if (!Array.isArray(value.sections)) return false
  return value.sections.every((section) => {
    if (!isRecord(section) || !hasOnlyKeys(section, ['id', 'title', 'content'])) return false
    return (
      typeof section.id === 'string' &&
      section.id.length > 0 &&
      typeof section.content === 'string' &&
      (section.title === undefined || typeof section.title === 'string')
    )
  })
}

function validScreenReferences(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.every((reference) => {
    if (!isRecord(reference) || !hasOnlyKeys(reference, ['at', 'type', 'target'])) return false
    return (
      isFiniteNumber(reference.at) &&
      reference.at >= 0 &&
      (reference.type === 'look' || reference.type === 'highlight') &&
      typeof reference.target === 'string' &&
      reference.target.length > 0
    )
  })
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

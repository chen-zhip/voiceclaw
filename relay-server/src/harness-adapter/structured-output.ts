import type {
  ChunkHandler,
  ScreenReference,
  SpeechContent,
  StructuredOutput,
  TextFormat,
  TextSection,
} from './types.js'
import { warn } from '../log.js'

export function parseStructuredOutput(raw: string): StructuredOutput {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    warn('[harness] Non-JSON output; using plain-text fallback')
    return plainOutput(raw)
  }
  if (!isRecord(value)) {
    warn('[harness] Structured output was not an object; using plain-text fallback')
    return plainOutput(raw)
  }
  const textContent =
    isRecord(value.text) && typeof value.text.content === 'string' ? value.text.content : null
  const speechValue = isRecord(value.speech) ? value.speech.content : undefined
  const speechContent =
    typeof speechValue === 'string'
      ? speechValue
      : typeof speechValue === 'number' || typeof speechValue === 'boolean'
        ? String(speechValue)
        : textContent
  if (speechContent == null) {
    warn('[harness] Structured output omitted usable speech/text; using plain-text fallback')
    return plainOutput(raw)
  }
  if (typeof speechValue !== 'string') {
    warn('[harness] Structured output used invalid or missing speech; applying fallback')
  }
  const output: StructuredOutput = {
    speech: {
      content: speechContent,
      ...(isRecord(value.speech) && typeof value.speech.emotion === 'string'
        ? { emotion: value.speech.emotion }
        : {}),
      ...(isRecord(value.speech) && typeof value.speech.speed === 'number'
        ? { speed: value.speech.speed }
        : {}),
      ...(isRecord(value.speech)
        ? optionalArray('screenReferences', parseScreenReferences(value.speech.screenReferences))
        : {}),
    },
  }
  if (
    isRecord(value.thinking) &&
    Array.isArray(value.thinking.steps) &&
    value.thinking.steps.every((step) => typeof step === 'string') &&
    typeof value.thinking.reasoning === 'string'
  ) {
    output.thinking = {
      steps: value.thinking.steps,
      reasoning: value.thinking.reasoning,
      ...(typeof value.thinking.confidence === 'number'
        ? { confidence: value.thinking.confidence }
        : {}),
    }
  }
  if (isRecord(value.text) && textContent != null) {
    const textFormat = isTextFormat(value.text.format) ? value.text.format : 'plain'
    if (value.text.format !== undefined && !isTextFormat(value.text.format)) {
      warn('[harness] Structured output used unsupported text format; defaulting to plain')
    }
    output.text = {
      content: textContent,
      format: textFormat,
      ...(typeof value.text.language === 'string' ? { language: value.text.language } : {}),
      ...optionalArray('sections', parseTextSections(value.text.sections)),
    }
  } else {
    output.text = { content: speechContent, format: 'plain' }
  }
  return output
}

export async function emitStructuredOutput(
  output: StructuredOutput,
  onChunk: ChunkHandler,
  options: { skipSpeech?: boolean } = {}
): Promise<void> {
  if (output.thinking) {
    await onChunk({ type: 'thinking.delta', content: JSON.stringify(output.thinking) })
  }
  if (!options.skipSpeech) await emitSpeech(output, onChunk)
  if (output.text) {
    await onChunk({
      type: 'text.delta',
      content: output.text.content,
      ...(output.text.format ? { format: output.text.format } : {}),
      ...(output.text.language ? { language: output.text.language } : {}),
      ...(output.text.sections ? { sections: output.text.sections } : {}),
    })
  }
  await onChunk({ type: 'complete', output })
}

export async function emitStructuredOutputStream(
  stream: AsyncIterable<string>,
  onChunk: ChunkHandler
): Promise<void> {
  let buffer = ''
  let emittedSpeech = ''
  let emittedSpeechNeedsFinalization = false
  let emittedSpeechMetadata = false
  for await (const fragment of stream) {
    buffer += fragment
    const extracted = extractCompleteJson(buffer)
    buffer = extracted.rest
    for (const raw of extracted.values) {
      const output = parseStructuredOutput(raw)
      if (emittedSpeech) {
        if (emittedSpeechNeedsFinalization) {
          await emitRemainingSpeech(output, emittedSpeech, onChunk, emittedSpeechMetadata)
        }
        await emitStructuredOutput(output, onChunk, { skipSpeech: true })
      } else {
        await emitStructuredOutput(output, onChunk)
      }
      emittedSpeech = ''
      emittedSpeechNeedsFinalization = false
      emittedSpeechMetadata = false
    }
    const currentSpeech = extractRootSpeechContent(buffer)
    if (currentSpeech?.startsWith(emittedSpeech) && currentSpeech.length > emittedSpeech.length) {
      const speechObject = extractCompletedObjectField(buffer, 'speech')
      if (speechObject) {
        const output = parseStructuredOutput(`{"speech":${speechObject}}`)
        await emitSpeech(output, onChunk, emittedSpeech.length)
        emittedSpeechNeedsFinalization = false
      } else {
        const metadata = emittedSpeech.length === 0 ? extractRootSpeechMetadata(buffer) : {}
        await onChunk({
          type: 'speech.delta',
          content: currentSpeech.slice(emittedSpeech.length),
          ...metadata,
        })
        emittedSpeechNeedsFinalization = true
        emittedSpeechMetadata ||= Object.keys(metadata).length > 0
      }
      emittedSpeech = currentSpeech
    }
  }
  if (buffer.trim()) {
    const output = parseStructuredOutput(buffer)
    if (emittedSpeech && emittedSpeechNeedsFinalization) {
      await emitRemainingSpeech(output, emittedSpeech, onChunk, emittedSpeechMetadata)
    }
    await emitStructuredOutput(output, onChunk, { skipSpeech: emittedSpeech.length > 0 })
  }
}

async function emitSpeech(
  output: StructuredOutput,
  onChunk: ChunkHandler,
  emittedCharacters = 0
): Promise<void> {
  await onChunk({
    type: 'speech.delta',
    content: output.speech.content.slice(emittedCharacters),
    ...(output.speech.emotion ? { emotion: output.speech.emotion } : {}),
    ...(output.speech.speed != null ? { speed: output.speech.speed } : {}),
    ...(output.speech.screenReferences
      ? {
          screenReferences: output.speech.screenReferences.map((reference) => ({
            ...reference,
            at: reference.at - emittedCharacters,
          })),
        }
      : {}),
  })
}

async function emitRemainingSpeech(
  output: StructuredOutput,
  emittedSpeech: string,
  onChunk: ChunkHandler,
  metadataAlreadyEmitted = false
): Promise<void> {
  if (!output.speech.content.startsWith(emittedSpeech)) return
  const hasRemaining = output.speech.content.length > emittedSpeech.length
  if (metadataAlreadyEmitted) {
    if (hasRemaining) {
      await onChunk({
        type: 'speech.delta',
        content: output.speech.content.slice(emittedSpeech.length),
      })
    }
    return
  }
  if (
    hasRemaining ||
    output.speech.emotion ||
    output.speech.speed !== undefined ||
    output.speech.screenReferences
  ) {
    await emitSpeech(output, onChunk, emittedSpeech.length)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTextFormat(value: unknown): value is TextFormat {
  return value === 'markdown' || value === 'plain' || value === 'code'
}

function parseScreenReferences(value: unknown): ScreenReference[] | undefined {
  if (!Array.isArray(value)) return undefined
  const references = value.flatMap((item): ScreenReference[] => {
    if (
      !isRecord(item) ||
      typeof item.at !== 'number' ||
      !Number.isFinite(item.at) ||
      (item.type !== 'look' && item.type !== 'highlight') ||
      typeof item.target !== 'string'
    )
      return []
    return [{ at: item.at, type: item.type, target: item.target }]
  })
  return references.length > 0 ? references : undefined
}

function parseTextSections(value: unknown): TextSection[] | undefined {
  if (!Array.isArray(value)) return undefined
  const sections = value.flatMap((item): TextSection[] => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.content !== 'string')
      return []
    return [
      {
        id: item.id,
        ...(typeof item.title === 'string' ? { title: item.title } : {}),
        content: item.content,
      },
    ]
  })
  return sections.length > 0 ? sections : undefined
}

function optionalArray<Key extends string, Value>(
  key: Key,
  value: Value[] | undefined
): { [Property in Key]?: Value[] } {
  return value ? ({ [key]: value } as { [Property in Key]?: Value[] }) : {}
}

function plainOutput(content: string): StructuredOutput {
  return {
    speech: { content },
    text: { content, format: 'plain' },
  }
}

function extractCompleteJson(input: string): { values: string[]; rest: string } {
  const values: string[] = []
  let rest = input
  while (true) {
    const start = rest.search(/\S/)
    if (start < 0) return { values, rest: '' }
    if (rest[start] !== '{' && rest[start] !== '[') return { values, rest }
    const end = findJsonEnd(rest, start)
    if (end < 0) return { values, rest }
    values.push(rest.slice(start, end + 1))
    rest = rest.slice(end + 1)
  }
}

function extractCompletedObjectField(input: string, field: string): string | null {
  const match = new RegExp(`"${field}"\\s*:\\s*\\{`).exec(input)
  if (!match || structuralDepthAt(input, match.index) !== 1) return null
  const start = input.indexOf('{', match.index + match[0].indexOf(':'))
  const end = findJsonEnd(input, start)
  return end < 0 ? null : input.slice(start, end + 1)
}

function extractRootSpeechContent(input: string): string | null {
  const speechMatch = /"speech"\s*:\s*\{/.exec(input)
  if (!speechMatch || structuralDepthAt(input, speechMatch.index) !== 1) return null
  const speechStart = input.indexOf('{', speechMatch.index + speechMatch[0].indexOf(':'))
  const contentPattern = /"content"\s*:\s*"/g
  contentPattern.lastIndex = speechStart + 1
  const contentMatch = contentPattern.exec(input)
  if (!contentMatch || structuralDepthAt(input, contentMatch.index) !== 2) return null
  return decodeJsonStringPrefix(input.slice(contentPattern.lastIndex))
}

function extractRootSpeechMetadata(input: string): Omit<SpeechContent, 'content'> {
  const speechMatch = /"speech"\s*:\s*\{/.exec(input)
  if (!speechMatch || structuralDepthAt(input, speechMatch.index) !== 1) return {}
  const speechStart = input.indexOf('{', speechMatch.index + speechMatch[0].indexOf(':'))
  const contentMatch = /"content"\s*:/.exec(input.slice(speechStart + 1))
  if (!contentMatch) return {}
  const prefixEnd = speechStart + 1 + contentMatch.index
  const prefix = input
    .slice(speechStart + 1, prefixEnd)
    .trim()
    .replace(/,\s*$/, '')
  if (!prefix) return {}
  try {
    const value: unknown = JSON.parse(`{${prefix}}`)
    if (!isRecord(value)) return {}
    return {
      ...(typeof value.emotion === 'string' ? { emotion: value.emotion } : {}),
      ...(typeof value.speed === 'number' ? { speed: value.speed } : {}),
      ...optionalArray('screenReferences', parseScreenReferences(value.screenReferences)),
    }
  } catch {
    return {}
  }
}

function decodeJsonStringPrefix(input: string): string {
  let decoded = ''
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (character === '"') return decoded
    if (character !== '\\') {
      decoded += character
      continue
    }
    const escape = input[index + 1]
    if (escape === undefined) return decoded
    if (escape === 'u') {
      const code = input.slice(index + 2, index + 6)
      if (!/^[0-9a-fA-F]{4}$/.test(code)) return decoded
      decoded += String.fromCharCode(Number.parseInt(code, 16))
      index += 5
      continue
    }
    const escapedCharacters: Record<string, string> = {
      '"': '"',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
    }
    if (!(escape in escapedCharacters)) return decoded
    decoded += escapedCharacters[escape]
    index += 1
  }
  return decoded
}

function structuralDepthAt(input: string, end: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = 0; index < end; index += 1) {
    const character = input[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{' || character === '[') depth += 1
    else if (character === '}' || character === ']') depth -= 1
  }
  return inString ? -1 : depth
}

function findJsonEnd(input: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < input.length; index += 1) {
    const character = input[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{' || character === '[') depth += 1
    else if (character === '}' || character === ']') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

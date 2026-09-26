export type HarnessWindowProjection =
  | { kind: 'text'; text: string }
  | { kind: 'marker'; target: string; mode: 'look' | 'highlight' }

export function projectHarnessWindowEvent(
  event: Record<string, unknown>
): HarnessWindowProjection | null {
  if (
    event.type === 'harness.semantic-output' &&
    event.classification === 'public-screen' &&
    typeof event.text === 'string' &&
    event.text.length > 0
  ) {
    return { kind: 'text', text: event.text }
  }

  if (
    event.type === 'screen.highlight' &&
    typeof event.target === 'string' &&
    (event.mode === 'look' || event.mode === 'highlight')
  ) {
    return { kind: 'marker', target: event.target, mode: event.mode }
  }

  return null
}

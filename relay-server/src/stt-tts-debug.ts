import { log } from './log.js'

export type SttTtsDebugEventName =
  | 'session.connect.start'
  | 'session.connect.complete'
  | 'session.connect.failed'
  | 'session.disconnect'
  | 'stt.audio.commit'
  | 'stt.recognition.complete'
  | 'stt.recognition.failed'
  | 'stt.recognition.timeout'
  | 'stt.recognition.cancelled'
  | 'harness.dispatch.start'
  | 'harness.dispatch.queued'
  | 'harness.dispatch.complete'
  | 'harness.speech.received'
  | 'harness.stream.rejected'
  | 'harness.terminal'
  | 'harness.failed'
  | 'harness.cancelled'
  | 'tts.synthesis.start'
  | 'tts.synthesis.complete'
  | 'tts.synthesis.failed'
  | 'tts.synthesis.cancelled'

export interface SttTtsDebugFields {
  stage?: 'session' | 'stt' | 'harness' | 'tts'
  sessionId?: string
  turnId?: string
  attemptId?: string
  providerId?: string
  componentRole?: 'stt' | 'harness' | 'tts'
  status?: string
  endpointReason?: 'client-commit' | 'provider-finalized'
  inputBytes?: number
  sampleRate?: number
  durationMs?: number
  transcriptText?: string
  transcriptCharacters?: number
  synthesisText?: string
  synthesisCharacters?: number
  speechCharacters?: number
  chunkCount?: number
  audioBytes?: number
  sequence?: number
  outcome?: string
  reason?: string
  error?: string
}

export interface SttTtsDebugRecorder {
  readonly enabled: boolean
  record(event: SttTtsDebugEventName, fields: SttTtsDebugFields): void
}

interface SttTtsDebugRecorderOptions {
  activation?: string
  sink?: (line: string) => void
  now?: () => Date
}

const ALLOWED_FIELDS = [
  'stage',
  'sessionId',
  'turnId',
  'attemptId',
  'providerId',
  'componentRole',
  'status',
  'endpointReason',
  'inputBytes',
  'sampleRate',
  'durationMs',
  'transcriptText',
  'transcriptCharacters',
  'synthesisText',
  'synthesisCharacters',
  'speechCharacters',
  'chunkCount',
  'audioBytes',
  'sequence',
  'outcome',
  'reason',
  'error',
] as const satisfies readonly (keyof SttTtsDebugFields)[]

export function createSttTtsDebugRecorder(
  options: SttTtsDebugRecorderOptions = {}
): SttTtsDebugRecorder {
  const enabled = (options.activation ?? process.env.VOICECLAW_STT_TTS_DEBUG) === 'true'
  const sink = options.sink ?? ((line: string) => log(line))
  const now = options.now ?? (() => new Date())

  return {
    enabled,
    record(event, fields) {
      if (!enabled) return
      try {
        const approved: Record<string, string | number> = {}
        const candidate = fields as Record<string, unknown>
        for (const key of ALLOWED_FIELDS) {
          const value = candidate[key]
          if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
            approved[key] = value
          }
        }
        sink(
          `[stt-tts-debug] ${JSON.stringify({
            marker: 'stt-tts-debug',
            timestamp: now().toISOString(),
            event,
            ...approved,
          })}`
        )
      } catch {
        return
      }
    },
  }
}

import type { HarnessAdapter, HarnessCapabilities } from '../../src/harness-adapter/interface.js'
import type { OutputChunk, StructuredOutput } from '../../src/harness-adapter/types.js'
import type { STTProvider, TranscriptCallback } from '../../src/stt/interface.js'
import type { RelayEvent, SessionConfigEvent } from '../../src/types.js'
import type { TTSProvider } from '../../src/tts/interface.js'

const stt = {
  async connect() {},
  processAudio() {},
  commit() {},
  onPartialTranscript(_callback: TranscriptCallback) {},
  onFinalTranscript(_callback: TranscriptCallback) {},
  onError(_callback: (message: string) => void) {},
  async disconnect() {},
} satisfies STTProvider

const tts = {
  async connect() {},
  async *synthesize() {
    yield { data: 'cGNt' }
  },
  getPlaybackPosition() {
    return 0
  },
  async stop() {},
  async disconnect() {},
} satisfies TTSProvider

const capabilities = {
  structuredOutput: 'partial',
  interruption: false,
  overlay: true,
  streaming: true,
} satisfies HarnessCapabilities

const harness = {
  id: 'test-harness',
  capabilities,
  async connect() {},
  async sendMessage() {
    return { cancel() {}, done: Promise.resolve() }
  },
  async interrupt(handle: { cancel(): void; done: Promise<void> }) {
    return handle
  },
  async overlayQuery(query: string) {
    return { content: query }
  },
  async disconnect() {},
} satisfies HarnessAdapter

const output = {
  thinking: { steps: ['inspect'], reasoning: 'Found the relevant module', confidence: 0.9 },
  speech: { content: 'I found the relevant module.' },
  text: { content: '## Result', format: 'markdown' },
} satisfies StructuredOutput

const chunks = [
  { type: 'thinking.delta', content: 'inspect' },
  { type: 'speech.delta', content: 'I found it.' },
  { type: 'text.delta', content: '## Result', format: 'markdown' },
  { type: 'complete', output },
] satisfies OutputChunk[]

const config = {
  type: 'session.config',
  provider: 'openai',
  voice: 'marin',
  brainAgent: 'none',
  apiKey: 'test-key',
  mode: 'stt-tts',
  sttProvider: 'deepgram',
  ttsProvider: 'elevenlabs',
  sttConfig: { model: 'nova-3', endpointingMs: 300 },
  ttsConfig: { voice: 'test-voice', sentenceBatchSize: 2 },
  outputPreference: 'both',
} satisfies SessionConfigEvent

const events = [
  { type: 'thinking.saved', localPath: 'thinking/session.jsonl' },
  { type: 'text.section', sectionId: 'result', content: 'Found it' },
  { type: 'screen.highlight', target: 'result', mode: 'look' },
] satisfies RelayEvent[]

const futureInterruptionEvent: RelayEvent = {
  // @ts-expect-error interruption Client events belong to a future change
  type: 'interruption.detected',
  spokenSoFar: 'I found',
  interruptionText: 'Stop',
  resumable: true,
}

const futureOverlayEvent: RelayEvent = {
  // @ts-expect-error overlay Client events belong to a future change
  type: 'overlay.response',
  query: 'Where?',
  content: 'On screen',
}

void capabilities
void chunks
void config
void events
void futureInterruptionEvent
void futureOverlayEvent
void harness
void stt
void tts

// @ts-expect-error speech is the required structured-output stream
const missingSpeech: StructuredOutput = { text: { content: 'details' } }

// @ts-expect-error unsupported output chunk discriminant
const invalidChunk: OutputChunk = { type: 'audio.delta', content: 'audio' }

// @ts-expect-error STT/TTS mode is the only composed mode
const invalidMode: SessionConfigEvent = { ...config, mode: 'composed' }

void missingSpeech
void invalidChunk
void invalidMode

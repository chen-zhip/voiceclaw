> **Reconciliation status (2026-08-31):** The checked implementation establishes a Relay scaffold and deterministic boundary-fake path. It does not establish production Claude Code, Codex, or Cherry Studio runtimes, Desktop Host supervision, or Client UX.

## Context

VoiceClaw currently uses a monolithic `ProviderAdapter` interface where each provider (OpenAI Realtime, Gemini Live) handles the complete voice interaction loop internally. Those existing adapters implement the S2S Direct Conversation Pipeline; Relay can also select the S2S Operator Conversation Pipeline through `voiceMode: "operator"`.

To support the STT/TTS Harness Conversation Pipeline, Relay needs a **composed adapter** that orchestrates three independent boundaries: STT Provider, Harness Integration Contract, and TTS Provider. This requires:
- A new adapter type (`ComposedAdapter`) alongside existing S2S adapters
- Provider abstractions for STT and TTS (similar to existing `ProviderAdapter`)
- A legacy Harness adapter boundary with stable IDs and injected test doubles
- Extension of relay event types to support structured output routing

Key constraints:
- Must not break the existing S2S Direct or S2S Operator Conversation Pipelines
- Reuse existing trace infrastructure (`TurnTracer`, Langfuse integration)
- Reuse existing media capture pattern for thinking storage
- No new npm dependencies
- Harness-first and Plugin-first remain the target architecture; this Relay-side adapter is a scaffold, not the final Provider integration boundary

The wire fields `mode` and `voiceMode`, and code identifiers such as `ComposedAdapter` and `HarnessAdapter`, are preserved for compatibility. They are legacy scaffold identifiers rather than canonical domain names.

See proposal.md for motivation and impact.

## Goals / Non-Goals

**Goals:**
- Enable Relay to select and exercise the STT/TTS Harness Conversation Pipeline alongside S2S Direct and S2S Operator
- Define clear STT/TTS/Harness boundary contracts with explicit degradation
- Support structured output (thinking/speech/text separation) when Harness is capable
- Capture thinking locally only by explicit opt-in and keep tracing metadata-first
- Minimize changes to existing S2S code paths

**Non-Goals:**
- Replace or deprecate the S2S Direct or S2S Operator Conversation Pipelines
- Build Harness tools themselves (only adapters)
- Claim production Claude Code, Codex, or Cherry Studio runtime integration
- Implement Desktop Host lifecycle, VoiceClaw Integration Plugins, Workspace Binding, Client entry points, or Conversation Archive behavior
- Build full client UX for interruption, overlay, or precise playback-time screen highlighting; this change implements Relay-side contracts, graceful fallbacks, and boundary-reported presentation events only
- Support visual/screen-sharing inputs (future)
- Mobile-specific STT/TTS implementations (platform APIs used via abstraction)

## Decisions

### Decision 1: STT/TTS Harness Composition

**Choice:** Implement the STT/TTS Harness Conversation Pipeline with the legacy `ComposedAdapter` code type, which implements `ProviderAdapter` and orchestrates STT, a Harness Integration Contract boundary, and TTS as pluggable components.

**Rationale:**
- Reuses existing adapter factory and session management
- Each component (STT/Harness/TTS) can be swapped independently
- Clear separation of concerns: ComposedAdapter is the orchestrator, not the implementer

**Alternatives considered:**
- **Modify existing adapters**: Rejected - would complicate S2S adapters with STT/TTS concerns
- **New session type**: Rejected - unnecessary duplication of session management logic

**Implementation:**
```typescript
// relay-server/src/adapters/composed/index.ts
export class ComposedAdapter implements ProviderAdapter {
  constructor(
    private stt: STTProvider,
    private harness: HarnessAdapter,
    private tts: TTSProvider,
    private outputRouter: OutputRouter
  ) {}

  async connect(config: SessionConfigEvent, sendToClient: SendToClient) {
    await Promise.all([
      this.stt.connect(config.sttConfig),
      this.harness.connect(config.harnessConfig),
      this.tts.connect(config.ttsConfig)
    ])
  }

  sendAudio(data: string) {
    // Route to STT
    this.stt.processAudio(data)
  }
}
```

### Decision 2: STT/TTS Provider Abstraction

**Choice:** Define `STTProvider` and `TTSProvider` interfaces mirroring existing mobile implementations but adapted for Node.js/relay.

**Rationale:**
- Mobile already has working STT/TTS abstractions (see `mobile/modules/expo-custom-pipeline/ios/Pipeline/`)
- Reuse the proven interface design, translate to TypeScript
- Keeps door open for future mobile/relay unification

**Alternatives considered:**
- **Use existing ProviderAdapter**: Rejected - too broad, includes Harness concerns
- **One unified AudioProvider**: Rejected - STT and TTS have different lifecycles

**Implementation:**
```typescript
// relay-server/src/stt/interface.ts
export interface STTProvider {
  connect(config: STTConfig): Promise<void>
  processAudio(pcmData: string): void
  onPartialTranscript(callback: (text: string) => void): void
  onFinalTranscript(callback: (text: string) => void): void
  disconnect(): Promise<void>
}

// relay-server/src/tts/interface.ts
export interface TTSProvider {
  connect(config: TTSConfig): Promise<void>
  synthesize(text: string): AsyncIterable<AudioChunk>
  getPlaybackPosition(): number  // For interruption tracking
  stop(): Promise<void>
  disconnect(): Promise<void>
}
```

### Decision 3: Legacy Harness Integration Contract Scaffold

**Choice:** Implement the Harness Integration Contract scaffold with the legacy `HarnessAdapter` code interface, including an explicit static `capabilities` field kept separate from runtime availability. The declaration is a legacy scaffold profile, not dynamic Provider capability negotiation.

**Rationale:**
- Deterministic Relay routing needs known behavior at the adapter boundary
- Registration must remain stable without claiming that a Provider runtime is installed or reachable
- Unsupported behavior degrades explicitly without silently changing Provider or executor

**Alternatives considered:**
- **Dynamic capability negotiation**: Rejected for this scaffold because the target Providers do not expose one complete, stable negotiation mechanism
- **Try-catch feature detection**: Rejected because operational errors do not define capability semantics
- **Assume all features**: Rejected because registration is not proof of support or availability

**Implementation:**
```typescript
// relay-server/src/harness-adapter/interface.ts
export interface HarnessAdapter {
  readonly capabilities: {
    structuredOutput: boolean | "partial"
    interruption: boolean
    overlay: boolean
    streaming: boolean
  }

  connect(config: HarnessConfig): Promise<void>
  sendMessage(msg: UserMessage, onChunk: ChunkHandler): Promise<StreamHandle>
  interrupt?(handle: StreamHandle, ctx: InterruptionContext): Promise<StreamHandle>
  overlayQuery?(query: string, ctx: OverlayContext): Promise<OverlayResponse>
}
```

The registry exposes `claude-code`, `codex`, and `cherry-studio` as stable known IDs. Default registration reports them unavailable unless a runnable boundary exists; injected adapters remain available to deterministic tests. The follow-up `complete-harness-provider-integrations` change replaces these legacy declarations with versioned Capability Profiles owned by provider-specific Integration Plugins.

### Decision 4: Structured Output Routing via OutputRouter

**Choice:** Create `OutputRouter` to parse structured output and route thinking/speech/text to their destinations without changing Harness-authored semantics. Speech remains eligible for TTS even when it contains code, tables, lists, or fragments of those structures split across arbitrary transport chunks. Separation checks may warn but never suppress, truncate, or rewrite speech. At the parser boundary, an omitted or unsupported `text.format` normalizes to `plain`; unsupported values additionally produce a centralized server-side warning.

**Rationale:**
- Centralizes the logic for handling structured vs plain text output
- Keeps ComposedAdapter focused on orchestration
- Reuses existing `SendToClient` abstraction
- Makes routing deterministic regardless of how a transport divides streamed content

**Alternatives considered:**
- **Route inside ComposedAdapter**: Rejected - mixes orchestration with output handling
- **Route inside each HarnessAdapter**: Rejected - duplicates logic across adapters

**Implementation:**
```typescript
// relay-server/src/adapters/composed/output-router.ts
export class OutputRouter {
  constructor(
    private tts: TTSProvider,
    private thinkingStorage: ThinkingStorage,
    private sendToClient: SendToClient
  ) {}

  async route(chunk: OutputChunk) {
    switch (chunk.type) {
      case "thinking.delta":
        await this.thinkingStorage.append(chunk.content)
        break
      case "speech.delta":
        // Sentence-level streaming — see Decision 9
        this.handleSpeechDelta(chunk.content)
        break
      case "text.delta":
        this.sendToClient({ type: "transcript.delta", source: "text", ... })
        break
      case "complete":
        this.flushSentenceBuffer()
        break
    }
  }
}
```

### Decision 5: Thinking Storage Mirrors MediaCapture Pattern

**Choice:** Implement `ThinkingStorage` with the same structure as existing `MediaCapture` (opt-in via env var, `~/.voiceclaw/` directory, append-only JSONL). Trace export remains metadata-only by default; content tracing requires a separate `VOICECLAW_TRACE_CONTENT=enabled` diagnostic opt-in. Before export, Relay replaces exact occurrences of non-empty `apiKey`, `authToken`, and `token` values from the active STT, Harness, and TTS configurations with `[REDACTED]`.

**Rationale:**
- Proven pattern already in production
- Users familiar with `VOICECLAW_MEDIA_CAPTURE` will understand `VOICECLAW_THINKING_CAPTURE`
- Same privacy-by-default philosophy
- Local diagnostic capture and remote trace-content export are separate permissions and risks

**Alternatives considered:**
- **Always-on storage**: Rejected - privacy risk, thinking may contain sensitive reasoning
- **Database storage**: Rejected - overkill for append-only logs
- **Reuse local-capture opt-in for trace content**: Rejected because enabling a local file must not implicitly authorize content export

**Implementation:**
```typescript
// relay-server/src/thinking/storage.ts
export class ThinkingStorage {
  private config = {
    enabled: process.env.VOICECLAW_THINKING_CAPTURE === "enabled",
    rootDir: process.env.VOICECLAW_THINKING_DIR || join(homedir(), ".voiceclaw", "thinking")
  }

  async append(sessionId: string, entry: ThinkingEntry): Promise<string> {
    if (!this.config.enabled) return ""
    const filepath = join(this.config.rootDir, `${sessionId}.jsonl`)
    await fs.appendFile(filepath, JSON.stringify(entry) + "\n")
    return filepath
  }
}
```

### Decision 6: Extend RelayEvent Types, Not Replace

**Choice:** Add new event types (`ThinkingSavedEvent`, `TextSectionEvent`, `ScreenHighlightEvent`) to existing `RelayEvent` union.

**Rationale:**
- Backward compatible - old clients ignore unknown events
- Reuses existing event dispatch infrastructure
- Future features (interruption, overlay) can add more events incrementally

**Alternatives considered:**
- **New event protocol**: Rejected - unnecessary versioning complexity
- **Overload existing events**: Rejected - breaks type safety

**Implementation:**
```typescript
// relay-server/src/types.ts
export type RelayEvent =
  | SessionReadyEvent
  | AudioDeltaEvent
  | TranscriptDeltaEvent
  | ThinkingSavedEvent      // NEW
  | TextSectionEvent        // NEW
  | ScreenHighlightEvent    // NEW
  | ...existing

export interface ThinkingSavedEvent {
  type: "thinking.saved"
  turnId: string
  localPath: string
  tracePath?: string  // Langfuse URL
}
```

### Decision 7: Reuse HTTP/SSE Mechanics as a Gateway Scaffold

**Choice:** Extract and generalize the HTTP+SSE mechanics from `tools/brain.ts::askBrain()` into `HarnessHTTPClient` for a configurable Harness gateway boundary.

**Rationale:**
- `askBrain` already has SSE parsing, trace propagation, and timeout handling
- The scaffold can be tested against an injected HTTP boundary without claiming a Provider-native protocol
- Error messages can identify the configured gateway without inventing Provider startup commands

**Alternatives considered:**
- **Rewrite HTTP client**: Rejected - unnecessary duplication
- **Use external library (axios, ky)**: Rejected - no new dependencies constraint

**Implementation:**
```typescript
// relay-server/src/harness-adapter/http-client.ts
// Extract HTTP/SSE mechanics and adapt for structured output.
// This endpoint is a VoiceClaw gateway contract, not a Claude Code native API.
export class HarnessHTTPClient {
  async chat(messages: Message[], onChunk: ChunkHandler, signal?: AbortSignal) {
    // Reuse askBrain's fetch + SSE parsing (lines 115-189)
    // Add: parse JSON chunks for thinking/speech/text
  }
}
```

The `/v1/chat/completions` request shape and `HarnessHTTPClient` are boundary scaffolding. They MUST NOT be documented as a real Claude Code, Codex, or Cherry Studio runtime, and connection errors MUST NOT recommend unsupported commands such as `claude --mode voice-plugin`.

`HarnessHTTPClient` injects an active OpenTelemetry context supplied by its caller. This scaffold does not manufacture a trace context when none is active and does not claim that every STT/TTS Harness request is bound to the `TurnTracer` generation; production turn-span binding belongs to `complete-harness-provider-integrations`.

### Decision 8: Conversation Pipeline Resolver Extends the Existing Factory

**Choice:** Extend existing `createAdapter()` as the implementation point for resolving the Conversation Pipeline. The exact compatibility matrix is:

- `mode: "stt-tts"` selects STT/TTS Harness regardless of `voiceMode`.
- Omitted, invalid, or `"s2s"` mode with omitted, invalid, or `"direct"` voice mode selects S2S Direct.
- Omitted, invalid, or `"s2s"` mode with `voiceMode: "operator"` selects S2S Operator.
- Omitted, invalid, or `"s2s"` mode with `voiceMode: "supervisor"` accepts the legacy scaffold value but executes S2S Direct.

**Rationale:**
- Single entry point for all adapter creation
- Session management code unchanged
- Resolution preserves the observable behavior of existing wire fields without inventing a separate Supervisor pipeline

**Alternatives considered:**
- **Separate factory for STT/TTS**: Rejected - duplicates session lifecycle logic
- **Auto-detect mode from config fields**: Rejected - implicit behavior is error-prone

**Implementation:**
```typescript
// relay-server/src/adapters/index.ts
export function createAdapter(config: SessionConfigEvent, ...): ProviderAdapter {
  if (config.mode === "stt-tts") {
    const stt = createSTTProvider(config.sttProvider, config.sttConfig)
    const harness = createHarnessAdapter(config.harnessId, config.harnessConfig)
    const tts = createTTSProvider(config.ttsProvider, config.ttsConfig)
    return new ComposedAdapter(stt, harness, tts, ...)
  }

  // Existing voiceMode routing resolves S2S Direct or S2S Operator.
  // The accepted supervisor scaffold value currently executes S2S Direct.
  switch (config.provider) {
    case "openai": return new OpenAIRealtimeAdapter(...)
    case "gemini": return new GeminiAdapter(...)
  }
}
```

### Decision 9: Sentence-Level Streaming TTS

**Choice:** Buffer speech deltas and synthesize in batches of n sentences (configurable), instead of synthesizing the whole response or per-delta. This mirrors the abandoned mobile custom-pipeline's `trySpeakCompleteSentences` mechanism (see `docs/openspec/add-stt-tts-mode/architecture-comparison.md`).

**Rationale:**
- Whole-response synthesis makes time-to-first-audio scale with total response length — unacceptable for complex Harness tasks that stream for 10s+
- Per-delta synthesis splits mid-word/mid-sentence, producing unnatural audio boundaries (TTS providers synthesize per sentence anyway)
- Batching n sentences at a time trades first-audio latency against prosody: smaller n starts audio sooner (lower time-to-first-audio), larger n gives the TTS model cross-sentence context for more natural rhythm/intonation

**Alternatives considered:**
- **Whole-response synthesis**: Rejected - first-byte latency scales with response length
- **Fixed-size chunking (N chars)**: Rejected - splits mid-word, breaks prosody
- **Word-level streaming**: Rejected - too granular, and most TTS APIs buffer internally per sentence

**Implementation:**
```typescript
// relay-server/src/adapters/composed/output-router.ts
export class OutputRouter {
  private speechBuffer = ""            // buffer for the in-progress (unterminated) sentence
  private sentenceQueue: string[] = [] // complete sentences already split out
  private pendingTTSCount = 0
  // n-sentence batching: smaller n = faster first-audio, larger n = more natural TTS prosody (don't go too large)
  private sentenceBatchSize = 1

  constructor(deps: Dependencies, sentenceBatchSize = 1) {
    this.sentenceBatchSize = Math.max(1, sentenceBatchSize)
  }

  handleSpeechDelta(delta: string) {
    this.speechBuffer += delta
    this.extractSentences()
    this.flushBatchIfReady()
  }

  private extractSentences() {
    // CJK punctuation included for Chinese speech
    const endings = ['.', '!', '?', '\n', '。', '！', '？']
    let lastIdx = -1
    for (let i = this.speechBuffer.length - 1; i >= 0; i--) {
      if (endings.includes(this.speechBuffer[i])) { lastIdx = i; break }
    }
    if (lastIdx === -1) return

    const sentence = this.speechBuffer.slice(0, lastIdx + 1).trim()
    this.speechBuffer = this.speechBuffer.slice(lastIdx + 1)
    if (sentence) this.sentenceQueue.push(sentence)
  }

  private flushBatchIfReady() {
    while (this.sentenceQueue.length >= this.sentenceBatchSize) {
      const batch = this.sentenceQueue.splice(0, this.sentenceBatchSize).join(' ')
      this.synthesizeBatch(batch)
    }
  }

  flushSentenceBuffer() {
    // on complete: flush the trailing partial sentence + any queued sentences below n
    const remaining = this.speechBuffer.trim()
    this.speechBuffer = ""
    const tail = [...this.sentenceQueue]
    this.sentenceQueue = []
    const final = (tail.length ? tail.join(' ') + ' ' : '') + remaining
    if (final.trim()) this.synthesizeBatch(final.trim())
  }

  private async synthesizeBatch(batch: string) {
    this.pendingTTSCount += 1
    try {
      for await (const chunk of this.tts.synthesize(batch)) {
        this.sendToClient({ type: "audio.delta", data: chunk.data })
      }
    } finally {
      this.pendingTTSCount -= 1
    }
  }
}
```

**Key invariants:**
- `sentenceBatchSize` (n) defaults to 1 (fastest first-audio); typical range 1–3; MUST be capped at ≤5 — larger n delays first-audio unacceptably for marginal prosody gain
- `pendingTTSCount` is backpressure: when it exceeds a cap, relay pauses TTS submission (queue overflow protection)
- `speechBuffer` and `sentenceQueue` are flushed on `complete` signal so trailing sentences without punctuation are never dropped
- Sentence ending set MUST include CJK punctuation (。！？) — Chinese speech uses these, not ASCII `.` `!` `?`
- Speech eligibility for TTS MUST NOT depend on whether code, table, or list syntax happens to be complete inside an individual delta
- Screen-reference progress is limited to positions reported by the TTS boundary; the ElevenLabs scaffold may report only after a synthesis request completes and therefore does not claim precise Client playback-time synchronization

### Decision 10: Explicit Supersession Boundary

**Choice:** Treat this change as the Relay scaffold baseline and `complete-harness-provider-integrations` as the production integration change.

**Current change owns:**
- Relay composition interfaces, session selection, structured output routing, local diagnostic storage, and deterministic boundary-fake integration
- Stable legacy Harness IDs and static declarations used only by the scaffold
- Recovery Guidance that explains explicit resubmission or selection of S2S Direct or S2S Operator, with no automatic retry, request replay, or Conversation Pipeline switch

**Follow-up change owns:**
- Real Claude Code and Codex runtimes and any supported Cherry Studio integration
- Desktop Host supervision, Native Provider Configuration, Workspace Binding, and trusted VoiceClaw Integration Plugins
- Versioned hard-coded Capability Profiles, operational Provider Availability, and Client UX
- Any executable recovery action, automatic retry policy, request replay, or supported Conversation Pipeline transition
- Production binding of Harness requests to Relay turn spans and precise Client playback-time synchronization

**Alternatives considered:**
- **Expand this completed change in place into the production architecture**: Rejected because it would erase the distinction between proven Relay scaffold behavior and unimplemented cross-context work
- **Archive this change as production-ready**: Rejected until the reconciliation tasks are applied and its legacy scope is labeled truthfully

## Review Baseline

The fixed Git comparison point for the final `$code-review` is `89c69d9115c93f2bab7af2ca66e1851395d87dee`.

## Risks / Trade-offs

### Risk: STT/TTS latency accumulates

**Impact:** STT→Harness→TTS adds 2-3 network hops compared to S2S's single connection.

**Mitigation:**
- Use streaming everywhere (Harness streaming, sentence-level TTS streaming, see Decision 9)
- Spec enforces <3s for simple queries, TTS starts within 2s for complex tasks
- Sentence batching bounds time-to-first-audio to the first n sentences (configurable), independent of total response length
- Future: local STT/TTS (Whisper.cpp, Kokoro) eliminates network hops

### Risk: Harness tool availability

**Impact:** A known Harness ID can be mistaken for a runnable Provider, or the configured gateway can be unavailable.

**Mitigation:**
- Keep stable registration separate from runtime availability
- Identify the configured boundary without inventing unsupported Provider commands
- Return Recovery Guidance for explicit resubmission or selection of S2S Direct or S2S Operator without presenting that guidance as an executable action

### Risk: Thinking chain privacy leak

**Impact:** If local capture or trace-content diagnostics are enabled, private reasoning can be exposed through files or telemetry.

**Mitigation:**
- Keep both local capture and trace-content export disabled by default and authorize them separately
- Redact configured secrets before explicitly authorized content export
- Documentation warns about sensitivity
- Spec enforces thinking content never reaches Client projections or the Conversation Archive

### Risk: Structured output non-compliance

**Impact:** If Harness returns plain text instead of JSON, parsing fails.

**Mitigation:**
- Spec requires graceful fallback (treat as speech content)
- HarnessAdapter validates output, logs schema violations
- Future: add structured output validation at Harness tool level

### Trade-off: Complexity vs Flexibility

**Choice:** Accept increased code complexity (4 new interfaces, 3 new modules) for flexibility to swap providers.

**Justification:**
- Users want Whisper vs Deepgram, ElevenLabs vs OpenAI TTS
- Future requirements (interruption, overlay) need Harness abstraction
- Monolithic adapter (all-in-one) would lock us into specific providers

### Trade-off: No Breaking Changes vs Clean Architecture

**Choice:** Keep the S2S Direct and S2S Operator implementations unchanged, and add the legacy `ComposedAdapter` implementation for STT/TTS Harness alongside them.

**Justification:**
- Zero risk to existing users
- Migration path: users opt in to STT/TTS Harness by setting `mode: "stt-tts"`
- No S2S Direct or S2S Operator deprecation is part of this change

## Migration Plan

**Phase 1: Reconcile the Relay scaffold (this change)**
1. Preserve existing interfaces, routing, storage, session selection, and boundary-fake tests as GREEN evidence
2. Make default Harness availability truthful and remove unsupported Provider startup guidance
3. Make tracing metadata-first with separately enabled, redacted diagnostic content
4. Relabel integration and manual verification as Relay scaffold evidence

**Phase 2: Production Provider integration (`complete-harness-provider-integrations`)**
1. Add real Claude Code and Codex runtime integrations through Desktop-hosted VoiceClaw Integration Plugins
2. Add versioned hard-coded Capability Profiles and operational Provider Availability
3. Add Workspace Binding, Native Provider Configuration, Client entry points, and end-to-end runtime verification
4. Define executable recovery actions, replay semantics, retry policy, and any supported Conversation Pipeline transitions
5. Bind production Harness requests to Relay turn-span contexts and add Provider/Client playback timing where supported

**Phase 3: Separate follow-up changes**
1. Add Conversation Archive import and scoped plugin grants
2. Add Intent Confirmation and Provider-native Approval routing
3. Add Harness-native planning workflows through Harness Plugins and thin integration bridges
4. Deepen the Provider registry so declarations, construction, availability, and diagnostics have one authoritative boundary
5. Decompose `RelaySession` responsibilities without changing the Conversation Pipeline behavior established here

**Rollback strategy:**
- If STT/TTS mode has critical issues, remove `mode: "stt-tts"` from client config
- S2S Direct and S2S Operator remain unaffected
- Thinking storage is append-only (no data loss on rollback)
- Reverting reconciliation behavior does not make the scaffold a production Provider integration; the follow-up boundary remains authoritative

## Open Questions

None. All decisions required for implementation are resolved.

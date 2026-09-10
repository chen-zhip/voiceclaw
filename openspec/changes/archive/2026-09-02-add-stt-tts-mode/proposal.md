> **Status Update (2026-08-31):** This change was initially marked complete. Reconciliation found that its artifacts overstated the delivered scope: the implementation completes a Relay-side scaffold and boundary-fake integration, while production Harness runtimes and Client entry points are deferred to `complete-harness-provider-integrations`.

## Why

The existing S2S Direct and S2S Operator Conversation Pipelines did not provide a Relay-side composition seam for independently selected speech recognition, Harness execution, speech synthesis, and structured presentation. This change establishes that scaffold without claiming production-ready Harness or Client integration.

## What Changes

- Add `session.config.mode: "stt-tts"` as the wire selection for the STT/TTS Harness Conversation Pipeline while preserving the existing `mode: "s2s"` branch and its `voiceMode`-based S2S Direct and S2S Operator behavior
- Define STT, TTS, and Harness Integration Contracts plus dependency-injected boundary implementations suitable for deterministic integration tests; `HarnessAdapter` remains a legacy scaffold identifier rather than the domain name of the contract
- Register stable Harness IDs while reporting runtime availability truthfully; registration and static declarations do not prove that a production Provider runtime exists
- Introduce structured output routing for private thinking, concise speech, detailed text, and presentation metadata without silently changing executor-authored Semantic Output; separation checks may warn but never suppress or rewrite Harness-authored speech, and omitted or invalid text formats normalize to plain text
- Add explicitly enabled local thinking storage and metadata-first tracing; exporting content requires a separate diagnostic opt-in and redaction
- Extend Relay events for structured text, thinking-save metadata, and screen-reference presentation
- Preserve input on STT failure, continue text on TTS failure, and provide Recovery Guidance for resubmitting input or explicitly selecting S2S Direct or S2S Operator after Harness failure without automatic retry or executor switching
- Defer real Claude Code, Codex, and Cherry Studio runtimes, Desktop Host lifecycle, Integration Plugins, Client entry points, executable Harness recovery, precise Client playback synchronization, production turn-span binding, Conversation Archive integration, confirmations, and planning workflows to follow-up changes

## Capabilities

### New Capabilities

- `voice/stt-tts-mode`: Relay-side STT→Harness→TTS composition, wire-level pipeline selection, and explicit failure degradation
- `harness-adapter/interface`: Legacy Relay scaffold implementation of the Harness Integration Contract with stable IDs, static declarations, truthful availability, and no claim of dynamic capability negotiation
- `voice/structured-output`: Non-mutating routing of thinking, speech, text, and presentation metadata
- `thinking/storage`: Opt-in local thinking storage with metadata-first, separately authorized content tracing

### Modified Capabilities

None. This is a new feature that runs alongside S2S Direct and S2S Operator without modifying either Conversation Pipeline.

## Impact

**Relay scaffold:**
- `relay-server/src/adapters/composed/` - STT/Harness/TTS orchestration and structured output routing
- `relay-server/src/harness-adapter/` - legacy `HarnessAdapter` boundary, HTTP gateway scaffold, registry, and boundary fakes
- `relay-server/src/stt/` and `relay-server/src/tts/` - provider ports and Relay-side adapters
- `relay-server/src/thinking/` - explicitly enabled local diagnostic storage

**Modified Code:**
- `relay-server/src/types.ts` - Extended event types (ThinkingSavedEvent, TextSectionEvent, ScreenHighlightEvent)
- `relay-server/src/session.ts` - Support for the `mode: "stt-tts"` wire selection
- `relay-server/src/tracing/turn-tracer.ts` - New methods for thinking and screen reference tracing
- `relay-server/src/adapters/index.ts` - Factory extended to create composed adapter

**Configuration:**
- New session config fields: `mode`, `sttProvider`, `ttsProvider`, `sttConfig`, `ttsConfig`, `outputPreference`
- Environment variables: `VOICECLAW_THINKING_CAPTURE` for local capture and the separate `VOICECLAW_TRACE_CONTENT` for diagnostic trace-content export; both require the exact value `enabled`

**Dependencies:**
- No new npm dependencies required - reuses existing `@opentelemetry/api`, `@langfuse/*`, and `ws`

**Follow-up impact:**
- `complete-harness-provider-integrations` owns production Harness runtimes, Desktop Host supervision, Integration Plugins, executable recovery with request identity and Harness Thread continuity, replacement of legacy scaffold identifiers, and Client UX
- The Relay scaffold propagates an active OpenTelemetry context supplied at its HTTP boundary and emits screen highlights when its TTS boundary reports crossed character progress; production turn-span binding and precise playback-time synchronization remain follow-up integration work
- Other follow-up changes own Conversation Archive import, intent confirmation, and planning workflows
- Omitting `mode` continues to resolve to the legacy `"s2s"` wire value; within that branch, omitted or invalid `voiceMode` selects S2S Direct, `"operator"` selects S2S Operator, and the accepted `"supervisor"` scaffold currently executes S2S Direct behavior
- This change does not add a Desktop or Mobile entry point

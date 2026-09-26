## Context

See `proposal.md` and `specs/voice/stt-tts-debug-output/spec.md`. The current STT/TTS path is composed in `createAdapter`: `ComposedAdapter` owns audio ingress and final transcripts, `HarnessAttemptSession` owns Host-routed attempt dispatch and terminal handling, and `HarnessSpeechDelivery` owns sentence batching, TTS calls, and client audio emission. Relay already timestamps stdout/stderr through `relay-server/src/log.ts`, while Desktop pipes the bundled Relay process into `relay-server.log` and forwards only an explicit environment allow-list.

The provider interfaces intentionally carry audio or text rather than observability concerns. Diagnostics therefore need correlation across several existing boundaries, must be testable without asserting raw console output, and must never serialize arbitrary configuration or event objects. Complete finalized STT and TTS-input text is approved for this explicitly enabled mode; binary media, secrets, and private reasoning remain prohibited.

Fixed comparison point for the final `$code-review`: `2264f0af6186abd25cf8185d635cf049f6ad3239`.

## Goals / Non-Goals

**Goals:**

- Give one STT/TTS turn a readable boundary-level timeline from component connection through audio input, recognition, Harness execution, synthesis, delivery, cancellation, or failure.
- Use stable structured records whose content can be asserted deterministically at public seams.
- Keep enablement, field selection, serialization, and sink-failure containment in one module.
- Reuse the existing Relay service log instead of adding a second log lifecycle.

**Non-Goals:**

- Recording or replaying microphone or synthesized audio.
- Logging partial transcripts, raw Harness event payloads, Provider-native frames, or private reasoning.
- Adding a UI toggle, runtime log-level mutation, remote telemetry, tracing spans, log rotation, or a new Client event.
- Measuring provider-internal substeps that are not observable at the current STT/TTS interfaces.

## Decisions

### Emit one-line structured records through a narrow diagnostic recorder

Add an STT/TTS diagnostic module that accepts a closed event name plus an allow-listed field record and writes one JSON object per line through a sink. Every record has a stable `[stt-tts-debug]` marker, event name, timestamp, session id, and optional turn/provider/stage fields. JSON keeps complete text containing newlines unambiguous in the existing log file and gives tests a stable shape.

The default sink delegates to the existing Relay logger. Recorder construction reads `VOICECLAW_STT_TTS_DEBUG` once and returns a no-op recorder unless its value is exactly `true`; Desktop adds that key to the bundled Relay forward allow-list. Alternatives: unconditional `console.log` calls throughout the pipeline (rejected because they are noisy, hard to test, and cannot consistently enforce content boundaries), or OpenTelemetry spans (rejected because operators need the existing local service log and full transcript/synthesis text does not belong in default tracing).

### Instrument existing orchestration boundaries instead of changing provider contracts

Pass the recorder through `AdapterFactoryDependencies` into `ComposedAdapter`, then into `HarnessAttemptSession` and `HarnessSpeechDelivery`. These boundaries already observe the behavior the operator needs:

- `ComposedAdapter`: selected component ids, connect outcomes, accumulated decoded audio byte counts, commit, final transcript, timeout/error, and cancellation.
- `HarnessAttemptSession` / stream routing: queued or dispatched attempt, public speech-unit receipt, rejection/failure, cancellation, and terminal outcome with the authoritative Harness turn identity.
- `HarnessSpeechDelivery`: exact text submitted to TTS, synthesis duration, output chunk/decoded-byte totals, abort, and failure.

Recognition elapsed time is boundary time: from the latest client commit when present, otherwise from the first buffered audio accepted before a provider-finalized transcript. The endpoint reason is correspondingly `client-commit` or `provider-finalized`; the design does not claim provider-internal ASR timing. Audio input bytes are computed from base64 length without retaining another decoded payload. Alternatives: add debug methods to every STT/TTS provider (rejected because it pollutes provider contracts and duplicates generic instrumentation), or instrument only GPT-SoVITS (rejected because the capability describes the selected STT/TTS pipeline, not one provider).

### Allocate and propagate correlation at the earliest authoritative boundary

The recorder is scoped to the Relay session id at adapter construction. `ComposedAdapter` continues creating the provisional Client turn id on first audio; once Host-routed dispatch returns its authoritative Harness turn/attempt identity, downstream records use that identity. Records before a turn exists omit `turnId` instead of inventing one, and connection records identify component role plus provider id. This preserves current identifiers and behavior rather than introducing a new correlation protocol.

Alternative: generate a diagnostic-only correlation id (rejected because it would force operators to reconcile two turn identities and would not match existing tests or Client events).

### Allow only explicit fields and contain sink failures

Each call site constructs fields from primitives already present at the boundary. It never passes `SessionConfigEvent`, provider configuration, Harness payloads, environment objects, audio strings, or synthesized chunk data to the recorder. Approved content fields are limited to `transcriptText` for a final STT result and `synthesisText` for a TTS submission; corresponding character counts are included. Media records carry counts only. Harness records carry event kind/outcome and duration but not payload content except public speech as it reaches the TTS delivery boundary.

The recorder wraps both serialization and sink invocation in `try/catch`; failure is intentionally swallowed so diagnostics cannot create a Client error or alter control flow. Alternatives: generic recursive redaction (rejected because deny-lists miss new secret shapes), or logging arbitrary objects after JSON serialization (rejected for the same reason and because private output could cross the boundary).

### Verify behavior at existing public seams with an injected sink

Tests inject an in-memory sink/recorder while exercising the production-facing seams already used by the repository: `createAdapter`/`ProviderAdapter` with fake `STTProvider`, `HarnessRoutingPort`, and `TTSProvider`; `HarnessAttemptSession`; `HarnessSpeechDelivery`; and Desktop `buildRelayEnv`. Assertions cover activation, stable event fields, full approved text, absent forbidden data, correlation, output equivalence, and sink-failure containment. Existing provider tests remain useful regression coverage but do not need provider-specific debug APIs.

## Risks / Trade-offs

- [Complete transcript and synthesis text can contain sensitive user content] → Keep diagnostics off by default, require exact explicit activation, label every line, document local-log exposure, and never forward these records to telemetry.
- [One-line JSON increases local log volume during long sessions] → Aggregate audio at commit/finalization and synthesis chunks at completion rather than logging every audio append or emitted chunk.
- [Boundary timing includes queueing and cannot isolate provider-internal phases] → Name durations by the measured boundary and avoid claiming deeper precision.
- [A turn may have provisional and authoritative identifiers at different stages] → Emit only the identifier authoritative at each boundary and include session correlation on every record.
- [Existing concurrent work touches the same orchestration files] → Apply in small test-first slices and preserve unrelated worktree edits.

## Migration Plan

1. Add the disabled-by-default recorder and deterministic tests.
2. Thread it through adapter construction and add lifecycle/recognition records.
3. Add Harness and TTS delivery records, then run focused and full Relay regression tests.
4. Forward `VOICECLAW_STT_TTS_DEBUG` through Desktop and document how to enable it for standalone and bundled Relay runs.
5. Roll back operationally by removing or setting the environment variable to any value other than `true`; code rollback removes only observational instrumentation and requires no data migration.

## Open Questions

- A future Desktop UI toggle and automatic expiry for content-bearing debug mode may improve operator safety, but neither changes this environment-controlled prototype capability.
- Retention and rotation remain governed by the existing Desktop service log; a dedicated retention policy can be designed separately if diagnostic use grows.

## TDD Workflow

The original checked tasks are existing GREEN evidence for the Relay scaffold, not evidence of production Harness runtimes or Client entry points. Reconciliation behavior is implemented as adjacent **RED → GREEN** checkbox pairs in section 15. Commands run from `relay-server/`.

**Rules:**

- RED adds one behavior test through a confirmed public seam, runs the named command, and fails for the expected missing-behavior reason.
- GREEN makes the minimum production change for that RED test and reruns the same command to green.
- Complete one pair before the next. Any task-local refactoring happens after its GREEN verification; broad review remains separate from RED/GREEN.
- Sections 1–3 use adjacent **RED CONTRACT → GREEN EVIDENCE** pairs. A RED CONTRACT records the behavior test that now guards the seam; it does not claim that a historical failing run was observed.
- Documentation, manual checks, broad regression, and performance acceptance are verification work, not forced into RED/GREEN pairs.

**Confirmed seams:** `STTProvider`; `TTSProvider`; `HarnessAdapter`; Harness registry; `HarnessHTTPClient.stream()`; `OutputRouter.route()`; `ThinkingStorage` public methods; `TurnTracer.attachThinking()`; `ComposedAdapter` through `ProviderAdapter`; `createAdapter()`; and `RelaySession` WebSocket event input/output. Use real in-process components where practical. Mock only system boundaries and provider ports: network, subprocesses, filesystem/time, STT, Harness, and TTS.

## 1. Interfaces and Types — Retrospective Contract Pairs

- [x] 1.1 RED CONTRACT — `test/types/stt-tts-contracts.ts` specifies the complete `STTProvider` seam; verify the contract fixture with `yarn typecheck:test` (no historical RED run asserted)
- [x] 1.2 GREEN EVIDENCE — `src/stt/interface.ts` satisfies the STT contract; verify with `yarn typecheck:test`
- [x] 1.3 RED CONTRACT — The contract fixture specifies `TTSProvider` streaming, playback, stop, and lifecycle methods; verify with `yarn typecheck:test` (no historical RED run asserted)
- [x] 1.4 GREEN EVIDENCE — `src/tts/interface.ts` satisfies the TTS contract; verify with `yarn typecheck:test`
- [x] 1.5 RED CONTRACT — The contract fixture specifies `HarnessAdapter` and valid `HarnessCapabilities` values; verify with `yarn typecheck:test` (no historical RED run asserted)
- [x] 1.6 GREEN EVIDENCE — `src/harness-adapter/interface.ts` satisfies the Harness contract; verify with `yarn typecheck:test`
- [x] 1.7 RED CONTRACT — The contract fixture specifies required/optional `StructuredOutput` fields and rejects invalid `OutputChunk` discriminants; verify with `yarn typecheck:test` (no historical RED run asserted)
- [x] 1.8 GREEN EVIDENCE — `src/harness-adapter/types.ts` satisfies structured output and chunk contracts; verify with `yarn typecheck:test`
- [x] 1.9 RED CONTRACT — The contract fixture specifies STT/TTS session configuration and relay event union membership while rejecting unsupported modes; verify with `yarn typecheck:test` (no historical RED run asserted)
- [x] 1.10 GREEN EVIDENCE — `src/types.ts` satisfies session and relay event contracts; verify with `yarn typecheck:test`

## 2. Deepgram STT — Retrospective Contract Pairs

- [x] 2.1 RED CONTRACT — The STT boundary test specifies connection settings and bounded pre-connect audio buffering; verify with `yarn vitest run test/stt/deepgram.test.ts -t "connects with recognition settings"` (no historical RED run asserted)
- [x] 2.2 GREEN EVIDENCE — `DeepgramSTTProvider.connect()` configures server-side VAD/endpointing and flushes buffered audio; verify with the same command
- [x] 2.3 RED CONTRACT — The STT boundary tests specify partial callbacks and joined final utterances; verify with `yarn vitest run test/stt/deepgram.test.ts -t "emits partial text"` (no historical RED run asserted)
- [x] 2.4 GREEN EVIDENCE — Deepgram recognition messages emit public partial/final transcript behavior; verify with the same command
- [x] 2.5 RED CONTRACT — The STT boundary tests specify commit, buffer cap, and disconnect lifecycle behavior; verify with `yarn vitest run test/stt/deepgram.test.ts -t "commits the utterance|caps pre-connection"` (no historical RED run asserted)
- [x] 2.6 GREEN EVIDENCE — `commit()` and `disconnect()` satisfy the public lifecycle behavior; verify with the same command
- [x] 2.7 RED CONTRACT — The STT boundary tests specify actionable missing-key, rejected-upgrade, socket, and upstream errors; verify with `yarn vitest run test/stt/deepgram.test.ts -t "actionable|setup instructions|reports upstream errors"` (no historical RED run asserted)
- [x] 2.8 GREEN EVIDENCE — Deepgram error mapping and `onError()` satisfy those contracts; verify with the same command
- [x] 2.9 RED CONTRACT — The STT factory test specifies default, case-insensitive, empty, and unknown provider behavior; verify with `yarn vitest run test/stt/factory.test.ts` (no historical RED run asserted)
- [x] 2.10 GREEN EVIDENCE — `createSTTProvider()` satisfies the factory contract; verify with the same command

## 3. ElevenLabs TTS — Retrospective Contract Pairs

- [x] 3.1 RED CONTRACT — The TTS boundary tests specify streamed PCM output and voice/model/sample-rate/speed request configuration; verify with `yarn vitest run test/tts/elevenlabs.test.ts -t "streams PCM chunks"` (no historical RED run asserted)
- [x] 3.2 GREEN EVIDENCE — `ElevenLabsTTSProvider.synthesize()` satisfies the streaming/configuration contract; verify with the same command
- [x] 3.3 RED CONTRACT — The TTS boundary tests specify cancellation and Phase 1 playback-position reset/progress; verify with `yarn vitest run test/tts/elevenlabs.test.ts -t "aborts in-flight|resets state"` (no historical RED run asserted)
- [x] 3.4 GREEN EVIDENCE — `stop()`, `disconnect()`, and `getPlaybackPosition()` satisfy those lifecycle contracts; verify with the same command
- [x] 3.5 RED CONTRACT — The TTS boundary tests specify sample-rate fallback plus graceful setup, network, HTTP, and empty-stream errors; verify with `yarn vitest run test/tts/elevenlabs.test.ts -t "falls back|graceful|rejects"` (no historical RED run asserted)
- [x] 3.6 GREEN EVIDENCE — ElevenLabs fallback and error mapping satisfy those contracts; verify with the same command
- [x] 3.7 RED CONTRACT — The factory test specifies `sentenceBatchSize` default 1 and clamp range 1–5; verify with `yarn vitest run test/tts/factory.test.ts -t "clampSentenceBatchSize"` (no historical RED run asserted)
- [x] 3.8 GREEN EVIDENCE — `clampSentenceBatchSize()` satisfies the configuration contract while actual batching remains in OutputRouter; verify with the same command
- [x] 3.9 RED CONTRACT — The TTS factory test specifies default, case-insensitive, empty, and unknown provider behavior; verify with `yarn vitest run test/tts/factory.test.ts -t "createTTSProvider"` (no historical RED run asserted)
- [x] 3.10 GREEN EVIDENCE — `createTTSProvider()` satisfies the factory contract; verify with the same command

## 4. Harness Gateway Scaffold Vertical Slices

- [x] 4.1 RED — Test that `sendMessage()` injects the structured-output contract; run `yarn vitest run test/harness-adapter/claude-code-adapter.test.ts -t "injects structured output"` and confirm the expected missing-adapter failure
- [x] 4.2 GREEN — Create the minimum legacy `ClaudeCodeAdapter` gateway scaffold and prompt injection for 4.1; rerun the same command and confirm it passes
- [x] 4.3 RED — Test that valid streamed JSON emits separate thinking, speech, text, and complete chunks; run `yarn vitest run test/harness-adapter/claude-code-adapter.test.ts -t "emits structured chunks"` and confirm the expected failure
- [x] 4.4 GREEN — Implement only stream parsing and schema validation for 4.3; rerun the same command and confirm it passes
- [x] 4.5 RED — Add one parameterized degradation test for plain text, missing speech, and invalid field types; run `yarn vitest run test/harness-adapter/claude-code-adapter.test.ts -t "degrades noncompliant output"` and confirm the expected failure
- [x] 4.6 GREEN — Implement only coercion, warning, and plain-text fallback for 4.5; rerun the same command and confirm it passes
- [x] 4.7 RED — Test that `StreamHandle.cancel()` and disconnect stop output within 500 ms; run `yarn vitest run test/harness-adapter/claude-code-adapter.test.ts -t "cancels active streams"` and confirm the expected failure
- [x] 4.8 GREEN — Implement active-stream cancellation for 4.7; rerun the same command and confirm it passes
- [x] 4.9 RED — Test supported interruption and cancel-and-restart degradation through capabilities; run `yarn vitest run test/harness-adapter/capabilities.test.ts -t "degrades interruption"` and confirm the expected failure
- [x] 4.10 GREEN — Implement the minimum interruption dispatch/fallback for 4.9; rerun the same command and confirm it passes
- [x] 4.11 RED — Test supported overlay and unsupported/slow overlay fallback within 3 seconds; run `yarn vitest run test/harness-adapter/capabilities.test.ts -t "degrades overlay"` and confirm the expected failure
- [x] 4.12 GREEN — Implement the minimum overlay dispatch, fallback, and timeout for 4.11; rerun the same command and confirm it passes
- [x] 4.13 RED — Test the three stable registry IDs, Claude creation, actionable unavailable entries, and unknown-ID choices; run `yarn vitest run test/harness-adapter/registry.test.ts` and confirm the expected failure
- [x] 4.14 GREEN — Implement the minimum Harness registry and availability descriptors for 4.13; rerun the same command and confirm it passes
- [x] 4.15 RED — Test actionable connection-refused and 401/403 mappings; run `yarn vitest run test/harness-adapter/http-client.test.ts -t "maps actionable errors"` and confirm the expected failure
- [x] 4.16 GREEN — Extract the reusable HTTP/SSE client and implement only the mappings for 4.15; rerun the same command and confirm it passes
- [x] 4.17 RED — Test that outgoing Harness requests carry active W3C `traceparent`; run `yarn vitest run test/harness-adapter/http-client.test.ts -t "propagates trace context"` and confirm the expected failure
- [x] 4.18 GREEN — Inject active trace context for 4.17; rerun the same command and confirm it passes
- [x] 4.19 RED — With fake time, test that normal Harness queries abort at 120 seconds; run `yarn vitest run test/harness-adapter/http-client.test.ts -t "times out queries"` and confirm the expected failure
- [x] 4.20 GREEN — Implement the default query timeout for 4.19; rerun the same command and confirm it passes

## 5. OutputRouter Vertical Slices

- [x] 5.1 RED — Through `route()`, test that thinking reaches storage/tracing but never transcript or TTS; run `yarn vitest run test/adapters/composed/output-router.test.ts -t "keeps thinking private"` and confirm the expected failure
- [x] 5.2 GREEN — Create OutputRouter and implement only thinking routing/separation for 5.1; rerun the same command and confirm it passes
- [x] 5.3 RED — Through `route()`, test ASCII and CJK sentence-boundary synthesis; run `yarn vitest run test/adapters/composed/output-router.test.ts -t "synthesizes complete sentences"` and confirm the expected failure
- [x] 5.4 GREEN — Implement the minimum sentence accumulator for 5.3; rerun the same command and confirm it passes without testing private helpers
- [x] 5.5 RED — Through `route()`, test default/configured/capped batching and trailing flush; run `yarn vitest run test/adapters/composed/output-router.test.ts -t "applies sentence batching"` and confirm the expected failure
- [x] 5.6 GREEN — Implement the minimum queue, batching, cap, and complete flush for 5.5; rerun the same command and confirm it passes
- [x] 5.7 RED — Test observable synthesis concurrency never exceeds provider capacity; run `yarn vitest run test/adapters/composed/output-router.test.ts -t "bounds TTS concurrency"` and confirm the expected failure without inspecting counters
- [x] 5.8 GREEN — Implement the minimum backpressure scheduler for 5.7; rerun the same command and confirm it passes
- [x] 5.9 RED — Through relay events, test text deltas and identified sections preserve content/format metadata; run `yarn vitest run test/adapters/composed/output-router.test.ts -t "routes structured text"` and confirm the expected failure
- [x] 5.10 GREEN — Implement text delta and `text.section` routing for 5.9; rerun the same command and confirm it passes
- [x] 5.11 RED — Test omitted text duplicates speech as text output; run `yarn vitest run test/adapters/composed/output-router.test.ts -t "falls back text to speech"` and confirm the expected failure
- [x] 5.12 GREEN — Implement only the fallback for 5.11; rerun the same command and confirm it passes
- [x] 5.13 RED — Test playback crossing a screen reference emits the correct `screen.highlight`; run `yarn vitest run test/adapters/composed/output-router.test.ts -t "synchronizes screen references"` and confirm the expected failure
- [x] 5.14 GREEN — Implement playback-position reference tracking for 5.13; rerun the same command and confirm it passes
- [x] 5.15 RED — Test a complete chunk flushes all streams and emits `turn.ended`; run `yarn vitest run test/adapters/composed/output-router.test.ts -t "completes the turn"` and confirm the expected failure
- [x] 5.16 GREEN — Implement only complete-signal finalization for 5.15; rerun the same command and confirm it passes
- [x] 5.17 RED — Test speech emotion/speed hints reach the TTS boundary; run `yarn vitest run test/adapters/composed/output-router.test.ts -t "forwards prosody hints"` and confirm the expected failure
- [x] 5.18 GREEN — Forward supported prosody and log unsupported emotion hints for 5.17; rerun the same command and confirm it passes
- [x] 5.19 HISTORICAL RED — The original test covered long-speech warnings and per-chunk prevention of detailed table/code duplication into speech. Review found that filtering is transport-chunk-dependent and violates non-mutating Semantic Output; Section 16 supersedes this behavior.
- [x] 5.20 HISTORICAL GREEN — The original separation validation/filtering implementation passed its task-local test. It is superseded by the warning-only, content-preserving behavior in 16.1–16.2.
- [x] 5.21 RED — Test TTS failure is logged while text and turn completion continue; run `yarn vitest run test/adapters/composed/output-router.test.ts -t "survives TTS failure"` and confirm the expected failure
- [x] 5.22 GREEN — Implement non-fatal TTS handling for 5.21; rerun the same command and confirm it passes

### 5A. Review Corrections

- [x] 5.23 RED — Through `OutputRouter.route()`, use a TTS adapter whose playback position advances only after iteration completes and test that the crossed reference emits `screen.highlight`; run `yarn vitest run test/adapters/composed/output-router.test.ts -t "synchronizes completed playback"` and confirm the expected failure
- [x] 5.24 GREEN — Recheck playback position after synthesis completion for 5.23; rerun the same command and confirm it passes
- [x] 5.25 RED — Through `ClaudeCodeAdapter.sendMessage()` and `interrupt()`, test resumed chunks continue through the original handler; run `yarn vitest run test/harness-adapter/claude-code-adapter.test.ts -t "preserves output after interruption"` and confirm the expected failure
- [x] 5.26 GREEN — Preserve the active stream handler across supported interruption for 5.25 without expanding `HarnessAdapter`; rerun the same command and confirm it passes
- [x] 5.27 RED — Through `ClaudeCodeAdapter.sendMessage()`, hold an SSE transport open and test a complete structured frame emits before transport completion; run `yarn vitest run test/harness-adapter/claude-code-adapter.test.ts -t "emits incremental transport frames"` and confirm the expected failure
- [x] 5.28 GREEN — Make `HarnessTransport.stream()` incremental and route complete structured frames as they arrive for 5.27; rerun the same command and confirm it passes
- [x] 5.29 RED — Through `ClaudeCodeAdapter.sendMessage()`, test valid screen references, text sections, format, and language survive parsing; run `yarn vitest run test/harness-adapter/claude-code-adapter.test.ts -t "preserves structured metadata"` and confirm the expected failure
- [x] 5.30 GREEN — Validate and preserve structured metadata through Harness chunks and relay events for 5.29; rerun the same command and confirm it passes
- [x] 5.31 RED — Through `queryOverlay()`, test the adapter observes an aborted signal when the 3-second fallback returns; run `yarn vitest run test/harness-adapter/capabilities.test.ts -t "cancels slow overlay"` and confirm the expected failure
- [x] 5.32 GREEN — Propagate and abort the overlay signal for 5.31; rerun the same command and confirm it passes
- [x] 5.33 REVIEW — After 5.23–5.32 are green, reorder public/private methods, split focused private behavior, and remove restating comments without changing interfaces or behavior
- [x] 5.34 VERIFY — Run Prettier on affected files, confirm existing lockfile resolution changes match the already-updated workspace manifests with `yarn install --immutable --mode=skip-build`, then verify affected Vitest suites, `yarn typecheck:test`, `yarn build`, and `openspec validate add-stt-tts-mode`

## 6. ThinkingStorage Vertical Slices

- [x] 6.1 RED — Test default-disabled, explicit-enable, and custom-directory configuration through `append()`; run `yarn vitest run test/thinking/storage.test.ts -t "applies privacy configuration"` and confirm the expected failure
- [x] 6.2 GREEN — Implement the minimum opt-in/path configuration for 6.1; rerun the same command using a temporary directory and confirm it passes
- [x] 6.3 RED — Test complete entries append as one JSONL line per turn in one session file; run `yarn vitest run test/thinking/storage.test.ts -t "appends complete session entries"` and confirm the expected failure
- [x] 6.4 GREEN — Define `ThinkingEntry` and implement append-only JSONL for 6.3; rerun the same command and confirm it passes
- [x] 6.5 RED — Test simultaneous public `append()` calls leave independently parseable lines; run `yarn vitest run test/thinking/storage.test.ts -t "serializes concurrent appends"` and confirm the expected failure
- [x] 6.6 GREEN — Add minimum per-session write serialization for 6.5; rerun the same command and confirm it passes
- [x] 6.7 RED — Through `load()`, test malformed lines are skipped while valid entries remain; run `yarn vitest run test/thinking/storage.test.ts -t "recovers valid JSONL lines"` and confirm the expected failure
- [x] 6.8 GREEN — Implement resilient loading for 6.7; rerun the same command and confirm it passes
- [x] 6.9 RED — Test slow/failed writes do not delay or fail turn completion and are logged; run `yarn vitest run test/thinking/storage.test.ts -t "keeps writes non-fatal"` and confirm the expected failure
- [x] 6.10 GREEN — Implement asynchronous non-fatal write scheduling for 6.9; rerun the same command and confirm it passes
- [x] 6.11 RED — Through the maintenance API, test size overflow compresses the older half and old files become cleanup candidates; run `yarn vitest run test/thinking/storage.test.ts -t "maintains retention limits"` and confirm the expected failure
- [x] 6.12 GREEN — Implement bounded rotation/compression and age discovery for 6.11; rerun the same command and confirm it passes
- [x] 6.13 RED — Test session deletion removes its file and complete wipe removes the configured directory; run `yarn vitest run test/thinking/storage.test.ts -t "deletes requested thinking data"` and confirm the expected failure
- [x] 6.14 GREEN — Implement explicit session cleanup and complete wipe for 6.13; rerun the same command and confirm it passes
- [x] 6.15 RED — Test successful save reports local/trace paths without thinking content; run `yarn vitest run test/thinking/storage.test.ts -t "reports safe save metadata"` and confirm the expected failure
- [x] 6.16 GREEN — Implement only safe save metadata for 6.15; rerun the same command and confirm it passes

## 7. TurnTracer Vertical Slices

- [x] 7.1 RED — Through `attachThinking()`, exporter-observe steps/reasoning/confidence metadata; run `yarn vitest run test/tracing/turn-tracer-thinking.test.ts -t "attaches thinking metadata"` and confirm the expected failure
- [x] 7.2 GREEN — Implement only thinking metadata mapping for 7.1; rerun the same command and confirm it passes
- [x] 7.3 RED — Through `attachScreenReferences()`, exporter-observe serialized references; run `yarn vitest run test/tracing/turn-tracer-thinking.test.ts -t "attaches screen references"` and confirm the expected failure
- [x] 7.4 GREEN — Implement only screen-reference tracing for 7.3; rerun the same command and confirm it passes

## 8. ComposedAdapter Vertical Slices

- [x] 8.1 RED — Through `ProviderAdapter`, test connect/disconnect lifecycle for STT, Harness, and TTS; run `yarn vitest run test/adapters/composed/composed-adapter.test.ts -t "manages component lifecycle"` and confirm the expected failure
- [x] 8.2 GREEN — Create ComposedAdapter and implement only lifecycle orchestration for 8.1; rerun the same command and confirm it passes
- [x] 8.3 RED — Test client audio reaches STT and partial text emits `transcript.delta`; run `yarn vitest run test/adapters/composed/composed-adapter.test.ts -t "routes streaming recognition"` and confirm the expected failure
- [x] 8.4 GREEN — Implement only audio/partial-transcript routing for 8.3; rerun the same command and confirm it passes
- [x] 8.5 RED — Test audio commit produces final text and calls `sendMessage()` with it; run `yarn vitest run test/adapters/composed/composed-adapter.test.ts -t "sends final transcript to Harness"` and confirm the expected failure
- [x] 8.6 GREEN — Implement only commit/final-transcript wiring for 8.5; rerun the same command and confirm it passes
- [x] 8.7 RED — Test Harness chunks traverse the real OutputRouter and emit synthesized `audio.delta`; run `yarn vitest run test/adapters/composed/composed-adapter.test.ts -t "routes Harness output to audio"` and confirm the expected failure
- [x] 8.8 GREEN — Implement only Harness-to-router orchestration for 8.7; rerun the same command and confirm it passes
- [x] 8.9 RED — With fake time, test STT timeout emits an actionable error and preserves buffered audio; run `yarn vitest run test/adapters/composed/composed-adapter.test.ts -t "preserves audio on STT timeout"` and confirm the expected failure
- [x] 8.10 GREEN — Implement only timeout/error propagation and retry buffering for 8.9; rerun the same command and confirm it passes
- [x] 8.11 HISTORICAL RED — The original test requested a generic S2S suggestion and cancel/restart degradation. The confirmed design now limits this change to advisory Recovery Guidance; 16.9–16.10 supersede any executable-recovery implication.
- [x] 8.12 HISTORICAL GREEN — The original fallback passed its task-local test. Its user-facing guidance is superseded by the explicit, non-executable recovery behavior in 16.9–16.10.

## 9. Adapter Factory Vertical Slices

- [x] 9.1 RED — Through `createAdapter()`, test STT/TTS selection and omitted/explicit S2S behavior without constructing STT/TTS; run `yarn vitest run test/adapters/factory-stt-tts.test.ts -t "selects session mode"` and confirm the expected failure
- [x] 9.2 GREEN — Add the minimum explicit mode branch for 9.1; rerun the same command and confirm it passes
- [x] 9.3 RED — Test required component config and `sentenceBatchSize` propagation; run `yarn vitest run test/adapters/factory-stt-tts.test.ts -t "validates composed configuration"` and confirm the expected failure
- [x] 9.4 GREEN — Instantiate factories and route validated configuration for 9.3; rerun the same command and confirm it passes
- [x] 9.5 RED — Test unknown/unavailable component IDs emit actionable choices before partial construction; run `yarn vitest run test/adapters/factory-stt-tts.test.ts -t "rejects unavailable components"` and confirm the expected failure
- [x] 9.6 GREEN — Implement only preflight availability validation for 9.5; rerun the same command and confirm it passes

## 10. Session Integration Vertical Slices

- [x] 10.1 RED — Through session events, test `session.config` selects composed mode and new events use existing dispatch; run `yarn vitest run test/session/stt-tts-mode.test.ts -t "dispatches composed sessions"` and confirm the expected failure
- [x] 10.2 GREEN — Make only session wiring changes for 10.1; rerun the same command and confirm it passes
- [x] 10.3 RED — Test older clients without `mode` remain on S2S and safely ignore new events; run `yarn vitest run test/session/stt-tts-mode.test.ts -t "preserves older clients"` and confirm the expected failure
- [x] 10.4 GREEN — Implement only defaulting/version behavior for 10.3; rerun the same command and confirm it passes

## 11. Configuration and Environment

- [x] 11.1 Document `VOICECLAW_THINKING_CAPTURE`; verify the relay README states capture is disabled unless set to `enabled`
- [x] 11.2 Document `VOICECLAW_THINKING_DIR`; verify the relay README shows default/custom locations
- [x] 11.3 Add an STT/TTS `session.config` example and verify required fields match public types
- [x] 11.4 Run `yarn install --immutable` and verify no new runtime dependency beyond existing OpenTelemetry, Langfuse, and `ws`

## 12. Cross-Seam Verification

- [x] 12.1 Add/run `yarn vitest run test/integration/stt-tts-pipeline.test.ts -t "emits audio for recognized speech"` with boundary fakes to verify the complete audio path
- [x] 12.2 Add/run `yarn vitest run test/integration/stt-tts-pipeline.test.ts -t "separates thinking speech and text"` to verify save/trace/audio/transcript separation and privacy
- [x] 12.3 Add/run `yarn vitest run test/integration/stt-tts-pipeline.test.ts -t "falls back from plain Harness output"` to verify non-JSON speech/text fallback
- [x] 12.4 Add/run `yarn vitest run test/integration/stt-tts-pipeline.test.ts -t "continues text after TTS failure"` to verify graceful degradation
- [x] 12.5 Run `yarn vitest run test/session/stt-tts-mode.test.ts -t "preserves older clients"` plus existing S2S adapter tests to verify compatibility
- [x] 12.6 Add deterministic timing coverage proving simple-query scheduling stays under 3 seconds and TTS starts within 2 seconds of the first speech chunk on long streams
- [x] 12.7 Exercise `mode: "stt-tts"` through the Relay WebSocket boundary with injected STT, Harness, and TTS fakes; record pipeline, structured-text, and explicit provider-failure degradation as scaffold evidence, not real-Provider verification
- [x] 12.8 Run `yarn test`; resolve regressions and make platform-dependent shell/symlink tests pass on Windows or encode justified supported-platform skips, leaving zero unexplained failures
- [x] 12.9 Run `yarn typecheck:test` and `yarn build` and verify both exit successfully

## 13. Documentation

- [x] 13.1 Add a ComposedAdapter architecture diagram matching design Decisions 1 and 4
- [x] 13.2 Document legacy static Harness declarations, stable registry IDs, and unavailable-adapter behavior in `docs/harness-integration.md` without presenting the gateway scaffold as a production Provider runtime
- [x] 13.3 Document STT/TTS provider contracts and configuration in the relay README
- [x] 13.4 Add an S2S-to-STT/TTS migration guide including backward-compatible defaults
- [x] 13.5 Document `sentenceBatchSize` default 1, typical 1–3, hard cap 5, and latency/prosody trade-off

## 14. Review and Refactoring

- [x] 14.1 After affected RED/GREEN pairs are green, run `$code-review`, apply behavior-preserving refactors only, and verify `yarn typecheck:test`, `yarn build`, and affected Vitest suites remain green

## 15. Scope Reconciliation

- [x] 15.1 GREEN EVIDENCE — Confirmed seam: `RelaySession` WebSocket `session.config` input through `createAdapter()`. Existing tests prove explicit `mode: "stt-tts"`, implicit session IDs, and omitted-mode S2S compatibility; verify with `yarn vitest run test/session/stt-tts-mode.test.ts test/adapters/factory-stt-tts.test.ts` (no retrospective RED asserted)
- [x] 15.2 HISTORICAL GREEN EVIDENCE — Confirmed seams: `ComposedAdapter` through `ProviderAdapter`, STT/TTS factories, and `OutputRouter.route()`. Existing tests proved preserved audio on STT timeout and continuing text after TTS failure. The former generic retry/S2S suggestion is superseded by the precise Recovery Guidance contract in 16.9–16.10.
- [x] 15.3 RED — Confirmed seam: Harness registry. Add behavior test `does not report an adapter runtime ready without a runnable provider`; run `yarn vitest run test/harness-adapter/registry.test.ts -t "does not report an adapter runtime ready without a runnable provider"` and confirm it fails because the default `claude-code` entry currently reports `available: true` for an HTTP scaffold with no production runtime
- [x] 15.4 GREEN — Minimum scope: keep the three stable known IDs and injected test construction, but make default runtime availability truthful and separate from static declarations; rerun the exact 15.3 command and confirm it passes
- [x] 15.5 RED — Confirmed seam: `HarnessHTTPClient.stream()`. Add behavior test `does not recommend unsupported provider startup commands`; run `yarn vitest run test/harness-adapter/http-client.test.ts -t "does not recommend unsupported provider startup commands"` and confirm it fails because connection refusal currently recommends `claude --mode voice-plugin`
- [x] 15.6 GREEN — Minimum scope: identify the configured Harness gateway and its unavailable state without inventing a Provider-native startup command; rerun the exact 15.5 command and confirm it passes
- [x] 15.7 RED — Confirmed seam: `TurnTracer.attachThinking()` observed through the trace exporter. Add behavior test `keeps thinking content out of traces by default`; run `yarn vitest run test/tracing/turn-tracer-thinking.test.ts -t "keeps thinking content out of traces by default"` and confirm it fails because steps and reasoning are currently exported as trace metadata
- [x] 15.8 GREEN — Minimum scope: export only thinking presence, size, classification, and capture status by default while leaving local opt-in storage unchanged; rerun the exact 15.7 command and confirm it passes
- [x] 15.9 RED — Confirmed seam: `TurnTracer.attachThinking()` observed through the trace exporter. Add behavior test `redacts explicitly enabled thinking trace content`; run `yarn vitest run test/tracing/turn-tracer-thinking.test.ts -t "redacts explicitly enabled thinking trace content"` and confirm it fails because no separate `VOICECLAW_TRACE_CONTENT=enabled` gate or secret redaction exists
- [x] 15.10 GREEN — Minimum scope: require the separate diagnostic opt-in and replace exact occurrences of non-empty active Provider `apiKey`, `authToken`, and `token` values with `[REDACTED]` before exporting authorized thinking fields; rerun the exact 15.9 command and confirm it passes
- [x] 15.11 Update Relay and Harness integration documentation to label this change as Relay scaffold plus boundary fakes, document `VOICECLAW_TRACE_CONTENT`, and link production runtime work to `complete-harness-provider-integrations`; verify the documented defaults and ownership match proposal.md and design.md
- [x] 15.12 Run Prettier on affected files, the targeted Harness/session/composed/tracing Vitest suites, `yarn typecheck:test`, `yarn build`, and `openspec validate add-stt-tts-mode --strict`; require zero unexplained failures before marking reconciliation complete

## 16. Confirmed Review Corrections

- [x] 16.1 RED — Through `OutputRouter.route()`, add a test proving code blocks, tables, and lists split across arbitrary `speech.delta` boundaries remain complete and are submitted to TTS; run `yarn vitest run test/adapters/composed/output-router.test.ts -t "preserves structured speech across chunks"` and confirm it fails because the current per-chunk check suppresses matching chunks
- [x] 16.2 GREEN — Remove speech suppression from separation validation while retaining centralized server-side warnings; rerun the exact 16.1 command and confirm all authored speech reaches TTS unchanged
- [x] 16.3 RED — Through the public structured-output parser, add a test proving an omitted `text.format` is emitted as `plain`; run `yarn vitest run test/harness-adapter/structured-output.test.ts -t "defaults omitted text format to plain"` and confirm it fails because the format is currently omitted
- [x] 16.4 GREEN — Normalize omitted `text.format` to `plain` at the parser boundary; rerun the exact 16.3 command and confirm it passes
- [x] 16.5 RED — Through the same parser seam, add a test proving an unsupported `text.format` preserves content, normalizes to `plain`, and records one centralized server-side warning; run `yarn vitest run test/harness-adapter/structured-output.test.ts -t "normalizes invalid text format with a warning"` and confirm the expected missing-warning/default failure
- [x] 16.6 GREEN — Implement only invalid-format normalization and warning behavior for 16.5; rerun the exact command and confirm it passes
- [x] 16.7 GREEN EVIDENCE — Add a table-driven contract test across the actual public seams: `resolveSessionMode()` normalizes omitted/invalid mode to `s2s`; `createAdapter()` selects STT/TTS Harness only for `stt-tts` and otherwise constructs the S2S Provider Adapter without using `voiceMode`; `effectiveVoiceMode()` resolves omitted/invalid/direct to Direct, operator to Operator, and the supervisor scaffold to Direct. Run `yarn vitest run test/adapters/conversation-pipeline-resolution.test.ts` and require the complete matrix to pass without asserting a nonexistent unified adapter discriminator.
- [x] 16.8 REVIEW — Confirm the 16.7 evidence requires no production resolver, wire rename, or new Adapter type. If the test reveals a real behavioral mismatch, split that mismatch into a new seam-specific RED→GREEN pair and revalidate before changing production code.
- [x] 16.9 RED — Through the STT/TTS Harness failure seam, test that an unreachable Harness reports actionable resubmission plus explicit S2S Direct/S2S Operator selection and does not claim or perform automatic retry, replay, or Conversation Pipeline switching; run `yarn vitest run test/adapters/composed/composed-adapter.test.ts -t "reports advisory Harness recovery guidance"` and confirm the current generic suggestion fails the contract
- [x] 16.10 GREEN — Implement Recovery Guidance only, with no executable recovery state or automatic transition; rerun the exact 16.9 command and confirm it passes
- [x] 16.11 Update Relay and Harness documentation to use S2S Direct, S2S Operator, STT/TTS Harness, Harness Integration Contract, and Recovery Guidance according to the confirmed resolver matrix; retain `mode`, `voiceMode`, `ComposedAdapter`, and `HarnessAdapter` only where wire or code compatibility requires them
- [x] 16.12 Verify ADR-0005 through ADR-0008 and the Relay glossary match the confirmed terminology and ownership boundaries; executable recovery remains assigned to `complete-harness-provider-integrations`
- [x] 16.13 Run Prettier on affected files, targeted tests for sections 16.1–16.10, the full Relay test suite, `yarn typecheck:test`, `yarn build`, and `openspec validate add-stt-tts-mode --strict`; require zero unexplained failures
- [x] 16.14 Run `$code-review` from fixed baseline `89c69d9115c93f2bab7af2ca66e1851395d87dee`, resolve in-scope Standards and Spec findings through Section 17, and repeat affected verification

## 17. Code Review Corrections

- [x] 17.1 RED — Through `handleInterruption()`, test that an unsupported interruption cancels the active stream and returns Recovery Guidance without accepting an executable restart callback; run `yarn vitest run test/harness-adapter/capabilities.test.ts -t "does not replay unsupported interruption"` and confirm the existing automatic restart fails the contract
- [x] 17.2 GREEN — Remove automatic restart and its callback seam from the unsupported interruption path, then return actionable Recovery Guidance for explicit resubmission; rerun the exact 17.1 command and confirm it passes
- [x] 17.3 RED — Through `listHarnessAdapters()`, test that each stable known ID exposes a static scaffold capability declaration separately from `available: false`; run `yarn vitest run test/harness-adapter/registry.test.ts -t "lists static scaffold capabilities separately from availability"` and confirm declarations are missing
- [x] 17.4 GREEN — Add conservative static scaffold profiles without claiming production capability negotiation or runtime availability; rerun the exact 17.3 command and confirm it passes
- [x] 17.5 RED — Through `OutputRouter.route()`, stream more than 500 speech characters across sub-500-character deltas and test for one warning while preserving all speech; run `yarn vitest run test/adapters/composed/output-router.test.ts -t "warns once for long speech across chunks"` and confirm the current per-chunk check misses it
- [x] 17.6 GREEN — Track turn-level speech length and warn once when it crosses 500 characters without changing routed content; rerun the exact 17.5 command and confirm it passes
- [x] 17.7 Remove the unused future `interruption.detected` and `overlay.response` Client event contracts and their type fixture entries; verify with `yarn typecheck:test`
- [x] 17.8 Replace user-facing “Harness adapter” errors with Harness Integration Contract terminology; preserve `HarnessAdapter` only as an internal code identifier and verify affected registry/factory tests
- [x] 17.9 Reconcile repository governance with documented contribution standards: remove feature-commit linting, rename the aggregate root typecheck script to `typecheck:all`, update its hook caller, and remove restating pre-commit comments
- [x] 17.10 Run Prettier, affected tests, full Relay tests, `yarn typecheck:test`, `yarn build`, strict OpenSpec validation, and repeat the two-axis review; defer only the explicitly recorded registry-depth and `RelaySession` decomposition smells

## 18. Repository Governance Separation

- [x] 18.1 Create a recoverable safety reference and non-destructive sibling worktrees without resetting, cleaning, rebasing, or force-updating the current dirty checkout or its remote branch
- [x] 18.2 Create the Governance base branch from the repository base and place `c9e8ca1`, the `CONTEXT.md` foundation, and ADR-0001 through ADR-0004 on that branch
- [x] 18.3 Create the Feature branch on top of Governance and place ADR-0005 through ADR-0008, Relay terminology changes, and the `add-stt-tts-mode` implementation on that branch
- [x] 18.4 Record separate `.scratch` follow-up issues for deepening the Provider registry and decomposing `RelaySession`; do not perform either refactor in this change
- [x] 18.5 Verify branch file ownership and commit ranges; require Governance build, aggregate typecheck, OpenSpec/pre-commit configuration, and diff checks to pass while recording its 48 pre-existing Windows path/symlink/shell test failures; require the stacked Feature's full Relay tests, test typecheck, build, aggregate typecheck, strict OpenSpec validation, and diff checks to pass; keep the existing remote feature branch untouched unless separately authorized

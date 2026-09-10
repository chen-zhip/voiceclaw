## Why

STT can produce fluent text that does not match what the user intended, yet the composed voice flow can pass that text to a Harness that owns real workspace and external-system side effects. VoiceClaw needs an explicit Intent Confirmation gate so users can correct what was understood without treating confirmation as a Provider-native Approval. This is an optional cross-runtime product capability, not an immutable Kernel responsibility.

## What Changes

- Deliver Intent Confirmation as an official Feature Plugin with a Relay `relay-service` Contribution, Desktop/Mobile `client-ui` Contributions, and optional Harness-facing Contributions, using Kernel Capability Contracts rather than adding Provider-specific behavior to Kernel.
- Add configurable Intent Confirmation modes for STT/TTS Harness conversations: required, risk-based, and disabled.
- Add a two-stage interaction in which the Harness interprets the finalized STT transcript without executing the task, then receives the confirmed request only after Relay's confirmation policy is satisfied.
- Determine enforceable read-only interpretation from the selected Integration Plugin's static Capability Profile. When the profile does not declare it, request prompt-only best effort, display a persistent warning and capability badge, and require confirmation rather than implying enforcement.
- Keep semantic interpretation and risk estimation Harness-owned. A Harness or Harness Plugin may return a structured risk hint covering likely local-file impact, cost, and reversibility; Relay applies the configured confirmation policy deterministically. Relay does not call a separate classifier or fallback model, and missing or uncertain risk always requires confirmation.
- Add a Relay-resident confirmation state machine owned by the Feature Plugin's Relay Contribution, covering interpretation, confirmation, supplementation, rejection, ambiguity, expiry, execution, explicit interruption, stale revisions, and idempotent resolution. Confirmation and resulting execution requests enter the existing Conversation Turn Queue and never run parallel Harness turns.
- Add structured confirmation requests and Relay events so active clients can display localized confirm/supplement choices while older clients continue through voice-only prompts. Other paired clients may explicitly take over the interaction.
- Add client-first volume/VAD behavior for fillers and continued speech, barge-in during spoken confirmation, and an explicit interrupt request when the user immediately corrects an already confirmed request.
- Keep Intent Confirmation events strictly separate from Provider-native Approval. Confirming an interpreted request never grants tool permissions; the Harness retains approval choices, enforcement, waiting, and timeout semantics.
- When correction arrives after execution starts, ask the Harness to stop future work through its profile-declared interruption/cancellation behavior and present only Provider-reported side effects. Offer rollback as a new explicit Harness request; the Harness determines rollback semantics and any native approvals.
- Preserve the original input, confirmation revision, and conversation when interpretation or execution fails. Offer explicit retry, Provider change, or return to S2S without silently changing executor.
- Keep S2S conversations backward compatible and unaffected. Trace confirmation metadata by default; content requires explicit opt-in and redaction.

## Capabilities

### New Capabilities

- `voice/confirmation`: Configurable STT intent restatement, Harness-owned risk hints, deterministic confirmation policy, revision-safe confirmation state, supplement/reject handling, audio/VAD interaction, client takeover, and execution gating.

### Modified Capabilities

None. This change adds VoiceClaw confirmation behavior on top of the completed STT/TTS Harness pipeline and the Provider/approval contracts from `complete-harness-provider-integrations`.

## Impact

- Deferred until after the prototype critical path. Depends on the archived `add-stt-tts-mode` scaffold, Kernel Phase 0, Harness Execution Routing, and a Provider Capability Profile that can represent interpretation/cancellation; the complete Approval Route and multi-Client behavior remain later dependencies rather than prototype prerequisites.
- Extends Relay session configuration, confirmation state, queue integration, Harness request/response metadata, client takeover, event types, metadata-first tracing, and tests.
- Requires Mobile and Desktop clients to render confirmation choices, warnings, revisions, takeover state, and calibrated voice-activity signals while preserving a voice-only interaction path.
- Does not own Provider permission persistence, semantic risk classification, task execution, side-effect reporting, cancellation guarantees, or rollback planning; those remain Harness or Harness Plugin responsibilities.

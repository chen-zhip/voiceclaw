## Context

See `proposal.md`, `specs/harness-execution/routing/spec.md`, and the modified `voice/stt-tts-mode` delta. The archived `add-stt-tts-mode` change is a tested scaffold, not proof of a Client entry or real Harness execution. ADR-0010 assigns deterministic provider-neutral acceptance here and real app-server acceptance to the downstream Codex change, removing the former dependency loop.

Fixed comparison point for final code review: `c9e8ca15d55cd9b2a58189333ef7d2d2273776a2`.

## Goals / Non-Goals

**Goals:** route finalized STT through one fenced `harness.execution@1` Attempt to TTS/Desktop; keep selection explicit and Provider-neutral; persist only Thread Mapping control state without Archive; make Archive/Memory optional.

**Non-Goals:** real Provider acceptance, durable message history without Archive, hidden Memory fallback, multi-Client arbitration, Native TUI, complete approvals, or Provider-native recovery/rollback.

## Decisions

### Routing owns Turn, Attempt, and persistent Thread Mapping

Relay assigns stable Turn identity and creates a new Attempt for every explicit dispatch. It persists `(conversationId, providerId, workspaceId) → harnessThreadId` as a typed Conversation Thread Mapping in Kernel's `ControlStateStore`. The Phase 0 atomic-JSON implementation contains no message content and does not implement Archive; a failed mapping write leaves the prior valid mapping version intact and prevents dispatch from claiming the new mapping was accepted.

Provider disabled, Host offline, or Provider update makes the mapping dormant. Deleting a Workspace Binding also makes mappings dormant and exposes explicit Forget Thread Mapping. Forgetting or deleting the VoiceClaw Conversation removes only VoiceClaw pointers, never the Provider-owned Thread.

### One active Turn, visible serial backlog

Only one Harness Turn is active per Conversation. Later finalized inputs remain ordered and visible; complex editing/reordering is deferred. Cancellation targets the active Attempt.

### Runtime execution uses one provider-neutral contract

Routing calls `provider.describe`, `thread.ensure`, `turn.start`, and `turn.cancel` through the `@voiceclaw/contracts` definition of `harness.execution@1.0.0`. The Kernel envelope owns auth/correlation; the Harness payload owns binding/Thread/Turn/Attempt/sequence. Relay rejects mismatched identity, stale generation, duplicate or out-of-order sequence, terminal-late output, and second terminals.

### Stream routing excludes private reasoning

Only public Semantic Output, Presentation State, bounded Outcome Evidence, usage, and terminal outcomes can cross Host RPC. Raw private Chain of Thought is neither a Structured Output branch nor something Feature Plugins can subscribe to. A plugin needing reasoning-like work must separately invoke an authorized model-inference Capability and receive new public structured output.

### Optional Archive and Memory never create fallbacks

With active authorized `archive.append`, Routing submits visible events. Without it, message content exists only for the Relay Session and may disappear on restart; the content-free Thread Mapping remains control state, not history. If the selected Archive provider rejects, times out, or disconnects, Routing exposes an explicit non-persistent/degraded status but does not change the Harness terminal outcome, withhold already public output or TTS, select another Archive provider, or promote Client SQLite, Tracing, Brain transcript synchronization, or Thread Mapping.

Memory retrieval/inclusion occurs only through active authorized contracts. Without Memory, no retrieval, production, controls, or transcript-to-Brain `remember` call occurs. If an authorized Memory retrieval fails before dispatch, Routing makes the degradation visible and continues the ordinary Harness Turn without Memory context; it does not select another Memory provider or reconstruct Memory from transcript/history. A later inclusion/production notification failure cannot rewrite an already accepted Harness terminal outcome.

The current `RelaySession` cleanup path calls `syncTranscriptToBrain()` for transcripts returned by an Adapter. This change must make the STT/TTS Harness Session cleanup path explicitly bypass that legacy behavior, verified through the public Relay Session/WebSocket lifecycle and a Brain boundary observer. Existing S2S behavior is not redefined by this routing change.

### Outcome Unknown is terminal for an Attempt

A proven pre-dispatch failure permits the user to create a new Attempt. `outcome-unknown` also permits a new Attempt only after explicit acknowledgment that side effects may have occurred. The previous Attempt remains terminal. No automatic replay, failover, or silent Pipeline switch occurs.

### Routing and Provider acceptance are separate

Routing uses a deterministic `harness.execution@1` fixture to prove microphone/session input, finalized dispatch, normalized streaming, TTS submission, Desktop playback observation, cancellation, fencing, and operation with no Archive or Memory package installed. That fixture is not a production Provider and cannot satisfy `integrate-codex-provider-prototype`. Codex alone owns real installed/authenticated app-server and physical microphone acceptance.

### Deferred routing facilities

[PROPOSED] Later changes add complete Approval Route, multi-Client takeover/arbitration, queue editing, Provider-native recovery/status, rollback, and Native TUI Handoff.

[TODO] Define production retention of Relay-Session-only message state and detailed restart UX; loss after restart remains allowed without Archive.

## Risks / Trade-offs

- No Archive means content can disappear; UI must state non-persistent mode.
- Thread Mapping persistence could be mistaken for Archive; schema and API must remain content-free.
- Partial speech may play before later failure; preserve emitted Semantic Output and report terminal state separately.
- Explicit recovery adds friction but avoids duplicate Harness side effects.

## Migration Plan

1. Add persistent control-plane Thread Mapping and Turn/Attempt state around the scaffold.
2. Replace production Relay Adapter dispatch with `harness.execution@1`; keep deterministic fixture only in tests.
3. Add Desktop pipeline/Provider/Workspace entry and playback observation.
4. Prove absent and failing optional Archive/Memory behavior and remove the STT/TTS Harness path from legacy transcript-to-Brain cleanup.
5. Complete this change against the provider-neutral fixture with no Archive or Memory implementation installed.
6. Let the downstream Codex change enable and accept the real Provider chain.

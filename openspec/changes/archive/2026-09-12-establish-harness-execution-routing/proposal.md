## Why

The archived `add-stt-tts-mode` change proves a Relay-side scaffold, but it still permits fake/no-op execution paths and lacks a Desktop Client entry and Desktop-hosted Harness contract. VoiceClaw needs provider-neutral turn routing that can be completed and tested before a concrete Provider, works without Archive or Memory, and preserves explicit failure/recovery semantics.

## What Changes

- Depend on Kernel Phase 0, Desktop Host Contract, and archived `add-stt-tts-mode`; do not depend on Archive, Memory, or Codex.
- Let the user explicitly select STT/TTS Harness and a registered Provider/Workspace binding, with at most one active Harness Turn per Conversation.
- Own stable Turn and Attempt identities, a persistent Relay control-plane Conversation Thread Mapping, and Active Host generation fencing.
- Persist Conversation Thread Mapping only as typed Relay Control State through the Kernel `ControlStateStore`; no routing task creates an Archive table, message store, or plugin data namespace.
- Dispatch finalized STT text through `harness.execution@1`, route provider-neutral public Semantic Output/Presentation State/Outcome Evidence, synthesize public speech through Relay TTS, and deliver Desktop playback events. Raw private reasoning is never a routing event.
- Define explicit new-Attempt behavior after known failure or user acknowledgment of `outcome-unknown`; never automatically replay or silently switch Provider, Host, or Conversation Pipeline.
- Treat Archive and Memory as optional Capabilities resolved at runtime rather than activation dependencies. Without Archive, message content exists only for the current Relay Session, while the content-free Thread Mapping persists as Relay Control State. Without Memory, retrieval, production, inclusion, and controls are absent. If an installed optional provider fails or times out, the Harness Turn continues with an explicit feature-level degraded result and no provider, storage, or Brain fallback.
- Accept this change against a deterministic provider-neutral `harness.execution@1` fixture. Only `integrate-codex-provider-prototype` owns real app-server and physical microphone-to-playback acceptance.
- Defer Native TUI Handoff, complete Approval Route, multi-Client arbitration, complex queue editing, and Provider-native recovery/rollback.

## Capabilities

### New Capabilities

- `harness-execution/routing`: Provider-neutral Conversation Turn dispatch through `harness.execution@1`, identities, persistent control-plane Thread Mapping, streaming, cancellation, terminal outcomes, fencing, optional Archive/Memory use, and explicit new-Attempt recovery.

### Modified Capabilities

- `voice/stt-tts-mode`: Add the Desktop Client entry and provider-neutral Desktop Host path to the archived STT/TTS scaffold. Deterministic fixture acceptance proves Routing only; a separate Provider change proves the real Harness chain.

## Impact

- Planning affects Relay Session routing, minimal Relay routing persistence, Host RPC consumption, TTS output routing, and Desktop Client pipeline selection/playback.
- Relay-side fake/no-op adapters remain migration inputs; deterministic contract fixtures may test Routing but cannot satisfy Codex or overall real-Harness acceptance.
- Client SQLite, Tracing, and Brain transcript synchronization remain non-authoritative and cannot substitute for absent Archive or Memory Capabilities.
- Shared envelopes and `harness.execution@1` schemas come from `@voiceclaw/contracts`; Routing imports no Archive, Memory, or Provider implementation package.

## Context

See `proposal.md` and `specs/harness-provider/codex-prototype/spec.md`. Kernel Phase 0, Desktop Host Contract, and Routing are strict upstream dependencies. Routing completes against a deterministic provider-neutral fixture; this change alone must prove a real Codex app-server and physical microphone path.

The installed planning baseline was verified as `codex-cli 0.153.4`. Fixed comparison point for final code review: `1f855d75fd58efc9a05cab12014473f1969d5b87`.

## Goals / Non-Goals

**Goals:** package Codex as the first Integration Plugin; implement all `harness.execution@1` operations; pin version/schema evidence; reuse one process per Host+configuration; normalize only public output; prove automated and physical real-Harness journeys.

**Non-Goals:** additional Providers, Chat Completions substitution, History Import, Native TUI, complete approvals, or advanced recovery.

## Decisions

### Codex is a first-party Phase 0 package

The package uses `voiceclaw.plugin.json` manifest v0, one Codex Feature Plugin, a Desktop `provider-integration`, and a compiled first-party settings `client-ui`. It consumes boundary schemas from `@voiceclaw/contracts` and provides `harness.execution` version `1.0.0`; Kernel, Host, Routing, and generic Client code never branch on `codex`. The package declares no required Archive or Memory Capability and imports no implementation from either Feature Plugin.

### The first exact Capability Profile is 0.153.4

Only `codex-cli 0.153.4` is exactly verified for the prototype. Implementation runs `codex app-server generate-json-schema`, commits the immutable full schema or documented required subset, records generator version `0.153.4`, and records SHA-256 of the committed bytes. Credential-free contract tests consume that artifact and do not regenerate it on every run.

Other detected versions use the nearest compatible known profile only when ADR-0003 policy allows, with a persistent unverified warning. Schema/profile mismatch fails closed before dispatch.

[TODO] Each newly supported exact Codex version requires a deliberate schema/profile artifact update and review; dynamic runtime discovery never invents VoiceClaw capability support.

### One process is keyed by Active Host and Native Provider Configuration

Desktop owns one app-server process for each `(activeHostId, nativeConfigurationIdentity)` and reuses it across sequential mapped Threads. Process-defining configuration includes executable and authentication context plus profile-declared settings. A different identity uses another process; the prototype does not multiplex conflicting configurations through one server.

### App-server transport remains Provider-local

The Integration owns stdio JSON-RPC, initialization, native IDs, methods, notifications, and error detail. `provider.describe` reports normalized profile/readiness; `thread.ensure` maps to supported Thread creation/resume; `turn.start` maps finalized text to a Turn stream; `turn.cancel` maps to native interruption.

### Translation is public and bounded

Agent-message deltas become public Semantic Output. Supported plan/progress/command/file/tool facts become Presentation State or bounded Provider-neutral Outcome Evidence. Raw reasoning is dropped before Host RPC. Unsupported events remain redacted, opt-in, local diagnostics and are never silently reclassified.

Terminal translation emits exactly one completed, failed, cancelled, or Outcome Unknown result with monotonic sequence. Only a proven pre-dispatch failure is safe for a normal explicit new Attempt; post-dispatch transport loss is Outcome Unknown.

### Acceptance has three levels

1. Credential-free golden JSON-RPC fixtures test translation, cancellation, schema, sequencing, and fencing.
2. An opt-in automated system test launches the real installed/authenticated app-server in a disposable Workspace through production boundaries using the minimal Profile with no Archive or Memory package.
3. A manual physical Desktop journey proves actual microphone capture, streamed screen output, audible TTS playback, cancellation, and Outcome Unknown UX using the same minimal Profile.

Fixture success is necessary but cannot complete the change. Ordinary Chat Completions, fake, no-op, or Relay-side Adapter behavior is never accepted as the Provider.

### Deferred Codex capabilities

[PROPOSED] Later multi-Provider work may add History Import, complete Approval Route, Native TUI Handoff, richer status/recovery, and profile parity.

[TODO] Define future approval and import mappings only in their owning successor changes.

## Risks / Trade-offs

- Protocol evolution is controlled by immutable schema/profile evidence and visible unverified-version policy.
- Real acceptance requires local authentication and therefore remains explicit and opt-in for automation.
- Process loss after dispatch becomes Outcome Unknown to prevent duplicate side effects.
- Raw native events may contain sensitive content, so only normalized public classes cross Host RPC.
- Accidental optional-feature coupling could hide behind the default distribution, so automated and physical acceptance both run with Archive and Memory packages absent and inspect the effective graph.

## Migration Plan

1. Add manifest/profile/schema artifacts with production selection disabled until readiness is proven.
2. Add process pool and initialization behind Desktop Host.
3. Implement `harness.execution@1` mapping, public translation, cancellation, and terminal outcomes.
4. Add generic Desktop configuration/selection metadata.
5. Pass deterministic fixtures, opt-in real system test, and physical voice journey with Archive and Memory packages absent.
6. Roll back by disabling the Codex package; S2S remains available.

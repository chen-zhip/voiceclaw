## Why

The tested STT/TTS Harness scaffold cannot host a real Desktop Provider without a minimum trusted plugin substrate, while the complete long-term plugin platform is too broad for the first runnable prototype. VoiceClaw therefore needs a deliberately narrow Kernel Phase 0 that proves package, Contribution, Capability, authorization, RPC, secret, and fencing boundaries without pulling Archive, Memory, marketplace, or general third-party isolation into the critical path.

## What Changes

- Define `voiceclaw.plugin.json` manifest v0 for one Feature Plugin per package. Phase 0 accepts only `desktop-service`, `provider-integration`, and prototype-required `client-ui` Contributions from VoiceClaw-shipped package roots or explicit development Profile allowlists.
- Establish the internal `packages/contracts` workspace (`@voiceclaw/contracts`) as the sole Phase 0 owner of implementation-neutral schemas and boundary types. It contains no Archive, Memory, or Provider implementation and creates no runtime dependency on those packages.
- Validate the fixed Phase 0 Manifest fields, package-confined entry paths, non-secret configuration Schema, requested permissions, and fixed startup/restart-required/retain lifecycle profile. A permission request never grants authority.
- Register versioned Capability Contracts using separate contract IDs and versions, select one compatible provider, and enforce a Capability Grant for the exact contract operation and Scope. Secret and Workspace use are narrowed further to declared references or bindings.
- Define Kernel-controlled Relay ↔ Desktop invocation using a provider-neutral Kernel Invocation Envelope. The first runtime contract is `harness.execution@1` with `provider.describe`, `thread.ensure`, `turn.start`, and `turn.cancel` operations.
- Track Contributions independently as `PENDING`, `LOADING`, `ACTIVE`, `DEGRADED`, `FAILED`, or `DISPOSED`; `ACTIVE` means loaded and callable, not that a Provider process, transport, or Session is ready.
- Provide a Desktop-owned Secret broker, assignment generation fencing, late-result rejection, and a secret-free inspectable effective plugin/Contribution graph labeled Phase 0.
- Persist only content-free Relay Control State through a Kernel-owned `ControlStateStore`; Phase 0 uses an atomically replaced JSON document whose last valid version survives a failed write. Plugins cannot access this store directly, and it cannot contain messages, attachments, Semantic Output, Memory, or evidence payloads.
- Distinguish required Capability dependencies from optional lookup. A missing optional provider does not block activation, and a minimal Profile with no Archive or Memory package must start successfully.
- Keep Provider-specific branches outside Kernel and Relay. Feature Plugins may invoke an authorized model-inference Capability to create new public structured output, but no plugin receives an executor's existing private Chain of Thought.
- Defer marketplace, automatic download/update, complete signing, third-party sandboxing/WASM, hot update, cross-device upgrade, general data export/uninstall/remount, complete UI Slots, arbitrary Mobile plugin code, and Archive/Memory business implementations as explicit `[PROPOSED]` or `[TODO]` work.

## Capabilities

### New Capabilities

- `plugin/kernel-phase-zero`: Minimum manifest v0 validation, first-party package discovery, Contribution lifecycle, Capability registration/selection/invocation, operation-and-Scope grants, Secret broker, layered cross-runtime RPC, fencing, and effective-graph behavior required by the runnable prototype.

### Modified Capabilities

None.

## Impact

- Planning affects the new internal `packages/contracts` workspace, Relay Kernel coordination and control state, Desktop Host Contribution loading, and prototype Client UI integration.
- This change is the only prerequisite shared by the prototype path and the deferred official Feature Plugin path.
- It does not implement Archive, Memory, Harness behavior, a Provider protocol, or third-party distribution.

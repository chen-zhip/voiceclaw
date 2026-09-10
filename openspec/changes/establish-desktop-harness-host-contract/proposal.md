## Why

Real Harness Providers use machine-local workspaces, processes, configuration, and credentials that Relay must not own. After Kernel Phase 0, VoiceClaw needs a provider-neutral Desktop Host contract that connects Relay to one selected local Host without depending on Archive or Memory.

## What Changes

- Make Desktop Host initiate a dedicated outbound WSS connection. A remote Relay uses a revocable per-install Host Credential obtained through one-time enrollment; a Desktop-owned bundled local Relay uses a per-startup Local Host Bootstrap Secret and does not issue a long-lived Relay credential.
- Consume Host and invocation schemas from `@voiceclaw/contracts`; neither Relay nor Desktop duplicates or extends them with Provider-specific wire fields.
- Keep Host, Client, and Provider credentials distinct. Provide owner-only Host status, last-activity, revoke, and re-register management for remote enrollment.
- Support one Desktop Host and one Active Host Assignment for Phase 0. Relay owns Logical Provider Binding, Active Host Assignment, and generation; Desktop reports readiness and resolves Workspace paths, Native Provider Configuration, processes, and secrets.
- Persist remote Host registration/revocation metadata and Active Host Assignment generation as Relay Control State through Kernel's `ControlStateStore`; do not store conversation content or introduce an Archive dependency.
- Load `provider-integration` Contributions through Kernel Phase 0 and expose `harness.execution@1` without Provider-native messages crossing the Host boundary.
- Start, adopt, or connect a local Harness Provider; expose Contribution state separately from executable, process, transport, and Provider Session readiness.
- Carry `provider.describe`, `thread.ensure`, `turn.start`, `turn.cancel`, streams, normalized errors, and terminal results through the Kernel Invocation Envelope; enforce sequence, generation, and terminal fencing.
- Map disconnects to proven pre-dispatch failure or `outcome-unknown`, never automatic resend or Host substitution.
- Defer multi-Host coordination/failover, Native TUI Handoff, complete credential rotation/recovery, third-party isolation, and general plugin installation/upgrade.

## Capabilities

### New Capabilities

- `desktop-host/harness-contract`: Authenticated outbound Host transport, local/remote Host authentication, Relay-owned assignment, native resource ownership, Provider Contribution hosting, readiness, `harness.execution@1` projection, cancellation, terminal outcomes, and generation fencing.

### Modified Capabilities

None.

## Impact

- Planning affects Relay Host-gateway contracts, owner Host management, and Desktop main-process Host services.
- Depends only on `establish-voiceclaw-feature-plugin-kernel` Phase 0.
- Archive, Memory, Harness History Import, Native TUI Handoff, concrete Provider protocols, and persistent Thread Mapping remain outside this change.

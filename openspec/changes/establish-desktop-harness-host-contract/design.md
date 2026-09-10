## Context

See `proposal.md` and `specs/desktop-host/harness-contract/spec.md`. The Desktop App already supervises a bundled Relay, while Harness executables, Workspace paths, and credentials are machine-local. This design consumes Kernel Phase 0 and excludes Archive and Memory.

Fixed comparison point for final code review: `c9e8ca15d55cd9b2a58189333ef7d2d2273776a2`.

## Goals / Non-Goals

**Goals:** one authenticated outbound Host connection, one Relay-owned Active Host Assignment, explicit native ownership, provider-neutral `harness.execution@1`, independent readiness, fencing, and deterministic disconnect outcomes.

**Non-Goals:** multi-Host failover, Provider-specific translation, persistent Thread Mapping, Archive, Memory, Native TUI Handoff, automatic credential recovery/rotation, or general plugin lifecycle.

## Decisions

### Desktop initiates a dedicated outbound WSS connection

Relay exposes a Host gateway separate from Client sessions. Desktop authenticates as a Host Principal and multiplexes Host control and Capability invocations over one outbound WSS connection. Relay never dials into Desktop and the Client transport does not tunnel Provider traffic.

### Local and remote Host authentication are distinct

For a remote Relay, an already authenticated Desktop owner/Client requests a short-lived one-time enrollment token. One Desktop installation exchanges it once for a persistent per-install Host Credential, stored in OS secure storage and revocable by Host ID. Phase 0 exposes owner-only Host ID, connection, last activity, revoke, and re-register management.

Token consumption, Host registration, credential verifier, revocation state, and last issued authority version are committed through Kernel's `ControlStateStore`; Relay never stores the reusable plaintext Host Credential. A repeated, expired, or already consumed enrollment token fails closed. Restart retains remote registration and revocation, while connection/readiness returns offline until a Host authenticates again.

For a bundled local Relay, Desktop creates a Local Host Bootstrap Secret on every bundled stack startup and provides it to Relay and Host through a controlled local launch channel. Relay does not issue a Host Credential for this path. The secret is never persisted or converted into a Relay-issued long-lived credential and expires with the owning Desktop/bundled stack. [PROPOSED] The implementation may use a scoped inherited process handle or authenticated local IPC; the concrete carrier is not part of the public Host contract.

Client and Provider credentials never substitute for either Host mechanism. [TODO] Automatic Host credential rotation and recovery remain post-prototype work.

### Relay owns assignment; Desktop owns native resolution

Relay owns Logical Provider Binding, the single Active Host Assignment, and its generation. Desktop reports which Contribution/configuration/Workspace resources are ready and resolves them locally; it never creates the assignment. Reassignment or authoritative reconnect increments generation. Acceptance checks generation before dispatch and at every event/terminal boundary.

Assignment selection and generation are committed through `ControlStateStore`. After Relay restart, the selection remains authoritative but unavailable until the registered Host reconnects and reports matching readiness; restart or reconnect never invents a replacement Host. No Host record contains message content.

### Host RPC projects the Kernel and Harness layers

The Kernel Invocation Envelope and `harness.execution@1.0.0` schemas come from `@voiceclaw/contracts`. The envelope supplies authorization, correlation, contract/version, operation, Principal, Scope, selected Contribution, generation, and trace. The Harness payload adds binding, Thread, Turn, Attempt, and sequence. The operations are `provider.describe`, `thread.ensure`, `turn.start`, and `turn.cancel`; provider-native transport remains behind the Integration Plugin.

One multiplexed connection uses bounded per-binding work. Exact message size, keepalive, and drain deadline are implementation constants documented by the protocol rather than public domain terms. Duplicate sequences, terminal-late events, second terminals, and stale generations are rejected.

### Desktop owns native configuration and process lifecycle

Desktop persists Workspace paths, executable location, Provider preferences, and opaque secret references. A process record distinguishes executable detection, starting/running/stopped/failed, transport readiness, Session readiness, and whether Desktop owns termination. The Codex prototype may reuse a locally owned process; this Host change defines only the provider-neutral supervisor seam.

### Contribution state and Provider readiness are different

`ACTIVE` means an implementation loaded and its contract is callable. Executable/process/transport/Session state is independent. A loaded Provider Contribution can be `DEGRADED` while Session is unavailable, and the settings UI may remain `ACTIVE` so the user can repair configuration.

### Disconnect maps to failure or Outcome Unknown

A proven pre-dispatch failure may be retried only by a new explicit Attempt. Once Provider acceptance or side effects are possible and no terminal is known, Relay records `outcome-unknown`. Neither condition triggers replay or Host substitution.

### Deferred Host facilities

[PROPOSED] Later changes may add multiple Host identities, automatic reassignment policy, credential rotation/recovery, Native TUI Handoff, binary attachment transfer, third-party isolation, and general installation/upgrade.

[TODO] Set heartbeat thresholds, maximum envelope size, drain deadlines, Workspace path canonicalization/symlink policy, and diagnostics redaction during production hardening.

## Risks / Trade-offs

- Single Host limits availability, so unavailability stays explicit and preserves input.
- Reconnect races are fenced by Relay-owned generation and invocation/Attempt identity.
- Local paths require platform-specific canonicalization before Provider execution.
- Desktop terminates only processes it started or explicitly adopted under an ownership record.

## Migration Plan

1. Add local/remote Host identity and the gateway without changing Client `/ws`.
2. Register Desktop Contributions and independent readiness in the effective graph.
3. Add Relay-owned assignment generation and provider-neutral `harness.execution@1` streaming.
4. Let Routing consume this Host contract; let Codex own Provider-specific behavior.
5. Verify Host startup and connection without Archive or Memory packages.
6. Roll back by disabling Host dispatch while retaining S2S paths and the last valid remote Host/assignment control records.

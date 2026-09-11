## Context

See `proposal.md` and `specs/plugin/kernel-phase-zero/spec.md`. ADR-0009 fixes the long-term plugin model and trusted boundary; ADR-0010 fixes the prototype-first order and assigns deterministic provider-neutral acceptance to Routing and real Provider acceptance to Codex. The repository has a tested Relay-side STT/TTS scaffold but no shared package contract, Desktop Contribution host, cross-runtime Capability invocation, or real Provider package.

Fixed comparison point for final code review: `1f855d75fd58efc9a05cab12014473f1969d5b87`.

## Goals / Non-Goals

**Goals:**

- Establish only the trusted substrate exercised by a first-party local Desktop Provider package.
- Make Feature Plugin, Contribution, Capability, operation-and-Scope grant, and layered RPC seams inspectable.
- Keep Relay, Desktop Host, and Client Provider-neutral.

**Non-Goals:**

- A production third-party ecosystem or complete lifecycle/data-portability platform.
- Archive, Memory, Harness behavior, or Provider protocol implementation.
- Arbitrary runtime code loading on Mobile.

## Decisions

### Phase 0 is a vertical trusted-kernel slice

Phase 0 spans the internal `packages/contracts` workspace plus Relay, Desktop Host, and the prototype Client shell. It is not a fourth process. The effective graph and diagnostics identify the supported platform as `phase: 0` so first-party local trust cannot be mistaken for the final security model.

`packages/contracts` publishes the private workspace package `@voiceclaw/contracts`. It owns implementation-neutral runtime schemas and TypeScript types used on more than one side of a process boundary, beginning with Manifest v0, Kernel Invocation Envelope, `harness.execution@1`, normalized stream/terminal/error shapes, and Host readiness projection. It has no imports from Relay, Desktop, Archive, Memory, or a Provider package. Runtime packages may depend inward on contracts; the contracts package never depends outward on implementations.

### One manifest v0 package delivers one Feature Plugin

The canonical filename is `voiceclaw.plugin.json`. The accepted root is:

```json
{
  "manifestVersion": 0,
  "id": "voiceclaw-provider-codex",
  "version": "1.0.0",
  "voiceclawVersionRange": ">=0.1.0 <0.2.0",
  "feature": { "id": "codex", "displayName": "Codex" },
  "contributions": [],
  "lifecycle": {
    "activation": "startup",
    "disable": "restart-required",
    "update": "restart-required",
    "uninstall": "unsupported",
    "dataDisposition": "retain"
  }
}
```

Each Contribution has a package-local unique `id`, `type`, `runtime`, package-confined relative `entry`, `provides`, `requires`, `configSchema`, and `requestedPermissions`. A provided contract is `{id, version}`; a required contract is `{id, range}`. Phase 0 accepts only `desktop-service`, `provider-integration`, and compiled first-party `client-ui` Contributions.

IDs are lowercase kebab-case, versions are SemVer, and `entry` is canonicalized and checked against the package root. The loader searches only VoiceClaw-shipped roots and roots explicitly allowlisted by a development Profile. Desktop loads local entries; Relay receives and revalidates only a secret-free Manifest projection.

[TODO] Later manifest versions must define signing identity, package integrity, source metadata, migrations, richer lifecycle, and portable data disposition before third-party distribution.

### Runtime managers reconcile one effective graph

Relay holds desired Profile selection, authoritative grants, and provider selection. Each runtime reports load state and operational readiness. `ACTIVE` means loaded and contract-callable; Provider executable/process/transport/Session readiness is distinct and may cause a Provider Contribution to report `DEGRADED` while its settings UI remains `ACTIVE`.

Required contract declarations form activation edges. Optional consumption is a runtime registry lookup and never forms an activation edge: no provider returns an explicit unavailable result, while a provider present but failing returns its normalized failure to the consumer. The Kernel does not silently select another provider.

### Relay Control State is not product data

The Kernel exposes a `ControlStateStore` only to trusted Relay authority modules. Phase 0 backs it with one revisioned JSON document written through same-directory temporary-file creation, flush/close, and atomic replacement. One in-process commit queue serializes mutations against the latest accepted revision; an optional expected revision rejects stale read-modify-write attempts rather than losing another authority update. Validation occurs before replacement; startup loads the last complete valid document, and a failed write leaves the prior version readable. The configured path is Relay-owned and independent of every plugin data namespace.

The document may contain Capability Grants and revocations, remote Host registration/revocation metadata, Active Host Assignment generations, and content-free Conversation Thread Mappings contributed by downstream changes. It rejects arbitrary plugin records and fields capable of storing conversation messages, attachments, Semantic Output, Memory content, or evidence payloads. This narrow persistence is required to preserve authority and fencing across restart without implementing Conversation Archive.

### Availability and authorization are separate

Discovery is content-free. Invocation requires a grant keyed by Principal, contract, operation, and Scope. Secret/workspace use is narrowed again to declared references or bindings. `requestedPermissions`, package installation, and dependency visibility are inputs to authorization review, never authorization themselves.

### Capability contracts and RPC are layered

The Kernel Invocation Envelope contains contract/version, operation, invocation ID, Principal, Scope, selected Contribution, authority generation, and trace correlation. The domain payload remains owned by the capability. This avoids coupling generic authorization and transport to Harness-specific identities.

The first streaming runtime contract is `harness.execution@1.0.0`:

- `provider.describe`
- `thread.ensure`
- `turn.start`
- `turn.cancel`

`turn.start` events carry invocation, binding, Thread, Turn, Attempt, generation, and monotonically increasing sequence. Exactly one terminal outcome is valid. Duplicate sequence, terminal-late event, and stale generation are rejected at the shared boundary.

### Desktop owns the Phase 0 Secret broker

Provider credential material remains in Desktop OS-secure storage or Provider-native storage. The broker resolves only declared local references for authorized Contributions and sends Relay only redacted readiness. First-party local trust does not bypass grants, resource bounds, or audit.

### Private reasoning is not a Capability payload

Provider Integrations must exclude raw private reasoning before Host RPC. Cross-boundary output is limited to public Semantic Output, Presentation State, bounded Provider-neutral Outcome Evidence, and content-free diagnostics. This does not stop Feature Plugins from using a separately granted model-inference Capability: that call creates new public structured output rather than reading another execution's private Chain of Thought.

### Deferred platform facilities remain explicit

[PROPOSED] Later Kernel phases add third-party trust tiers, signing and review, marketplace/download/update, per-runtime sandboxing or WASM, hot update, cross-device upgrade, data export/uninstall/remount, complete UI Slots, quotas, and arbitrary Mobile extension policy.

[TODO] Confirm third-party isolation by runtime, uninstall data disposition, and cross-device upgrade/version-skew protocol before promoting these facilities.

### The minimal prototype Profile excludes Archive and Memory

The acceptance Profile contains Kernel Phase 0, Desktop Host, Harness Execution Routing, Codex, and required STT/TTS providers only. Archive and Memory packages are not installed. Their contract identifiers may exist in `@voiceclaw/contracts`, but no implementation module is imported, discovered, or activated. The effective graph reports optional capability absence without marking Kernel, Host, Routing, Codex, or the surrounding Feature Plugin failed.

## Risks / Trade-offs

- [Trusted local mode could be mistaken for final security] → Label graphs/diagnostics Phase 0 and retain grants, secret mediation, RPC checks, and audit.
- [Manifest v0 could become accidental long-term API] → Keep it explicitly versioned and reject unsupported fields/facilities rather than silently promising them.
- [Cross-runtime coordination can overgrow] → Implement only operations needed by Host, Routing, and Codex.
- [Effective graph can leak local configuration] → Include identities, versions, states, reasons, readiness, and grant summaries only; redact paths and secrets.
- [Control persistence could become a hidden Archive] → Accept only typed control records, reject content-bearing fields, and prove the minimal Profile cannot recover messages after restart.
- [A contract package could create implementation coupling] → Enforce an inward-only dependency rule and test that the minimal Profile resolves with no Archive/Memory package present.

## Migration Plan

1. Add `@voiceclaw/contracts`, Manifest v0, Kernel Invocation Envelope, and `harness.execution@1` schemas without importing implementations.
2. Add `ControlStateStore`, effective graph, and Contribution reconciliation without changing S2S behavior.
3. Enable layered Host RPC and `harness.execution@1` behind explicit STT/TTS Harness selection.
4. Prove the minimal Profile starts without Archive/Memory; let Routing complete against a deterministic contract fixture.
5. Remove the prototype's fake/no-op path only after the separate Codex real-Harness acceptance passes.
6. Roll back by disabling the prototype Profile/package; existing S2S paths remain unchanged and the last valid control-state file remains readable.

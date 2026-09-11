## Purpose

Defines the minimum trusted plugin substrate required to run a first-party Desktop Harness prototype while preserving the long-term Feature Plugin, Contribution, Capability Contract, authorization, secret, and fencing boundaries.

## ADDED Requirements

### Requirement: Phase 0 package and Manifest validation

The Kernel SHALL accept only a `voiceclaw.plugin.json` document with `manifestVersion: 0`, a globally unique lowercase kebab-case `id`, a SemVer `version`, a SemVer `voiceclawVersionRange`, exactly one `feature` object containing `id` and `displayName`, and one or more Contribution declarations. Each Contribution SHALL have a package-local unique `id`, supported `type`, declared `runtime`, normalized package-relative `entry`, `provides`, `requires`, `configSchema`, and `requestedPermissions`.

#### Scenario: Valid first-party prototype package

- **WHEN** an allowlisted local package declares one Feature Plugin and only Phase 0 Contribution categories with compatible identifiers, versions, contracts, configuration, and requested permissions
- **THEN** the Kernel accepts the package for dependency resolution without activating it or implicitly granting any permission

#### Scenario: Invalid or incompatible Manifest

- **WHEN** a package omits a required field, uses an invalid ID or version, declares more than one Feature Plugin, duplicates a Contribution ID, uses an unsupported category, or is incompatible with the running VoiceClaw version
- **THEN** the Kernel rejects it with a diagnosable validation result and loads none of its Contributions

#### Scenario: Contribution entry escapes the package

- **WHEN** a Contribution `entry` is absolute or normalizes outside its package root
- **THEN** the Kernel rejects the complete package before loading code

### Requirement: Phase 0 package discovery and lifecycle profile

The Kernel SHALL discover only packages shipped in first-party VoiceClaw roots or roots explicitly allowlisted by the active development Profile. Manifest v0 SHALL use `activation: startup`, `disable: restart-required`, `update: restart-required`, `uninstall: unsupported`, and `dataDisposition: retain`.

#### Scenario: Unallowlisted package is present

- **WHEN** a local package is outside a shipped or development-allowlisted root
- **THEN** the Kernel ignores or rejects it and does not infer trust from filesystem proximity

#### Scenario: Runtime receives a Manifest projection

- **WHEN** Desktop sends an accepted Manifest projection to Relay
- **THEN** Relay revalidates the projection without receiving secret values or loading the Desktop entry module

### Requirement: Phase 0 Contribution categories and independent state

The Kernel SHALL support `desktop-service`, `provider-integration`, and the minimum prototype `client-ui` categories and SHALL report each Contribution independently as `PENDING`, `LOADING`, `ACTIVE`, `DEGRADED`, `FAILED`, or `DISPOSED` with a reason. `ACTIVE` SHALL mean loaded and contract-callable, while Provider process, transport, and Session readiness remain separate operational state.

#### Scenario: Dependency is not yet available

- **WHEN** an enabled Contribution lacks a required compatible Capability provider or required runtime
- **THEN** that Contribution remains `PENDING` without marking unrelated Contributions in the same Feature Plugin as failed

#### Scenario: Provider Session becomes unavailable

- **WHEN** a loaded Provider Contribution remains callable but its Provider Session is unavailable
- **THEN** the Provider Contribution reports `DEGRADED` with separate Session readiness while its settings UI may remain `ACTIVE`

#### Scenario: Contribution is disposed

- **WHEN** a Contribution is disabled or its package is unloaded during an allowed lifecycle transition
- **THEN** the Kernel stops accepting new calls, disposes registered effects, and reports `DISPOSED`

### Requirement: Minimum dependency graph

The Kernel SHALL resolve required Capability Contracts against compatible selected providers before activating a consumer and SHALL detect missing dependencies and cycles. Optional Capability lookup SHALL NOT create an activation dependency.

#### Scenario: Compatible dependency graph

- **WHEN** all required contracts have compatible selected providers and required grants are satisfiable
- **THEN** the Kernel exposes an activation order consistent with the dependency graph

#### Scenario: Dependency cycle

- **WHEN** enabled Contributions form a required-contract cycle
- **THEN** the Kernel reports the cycle and leaves the affected Contributions non-active

#### Scenario: Optional provider is absent

- **WHEN** an active consumer looks up an optional Capability and no compatible provider is active
- **THEN** the Kernel returns an explicit unavailable result without changing that consumer or unrelated Contributions to `PENDING` or `FAILED`

### Requirement: Configuration Schema validation

The Kernel SHALL validate non-secret plugin configuration against the package-declared Schema before activation and after every accepted configuration change.

#### Scenario: Configuration is invalid

- **WHEN** a user submits configuration that does not satisfy the declared Schema
- **THEN** the Kernel rejects the change, preserves the last accepted configuration, and exposes no secret values in the error

### Requirement: Versioned Capability declarations and provider selection

Manifest v0 SHALL declare provided contracts as `{id, version}` and required contracts as `{id, range}`. The Kernel SHALL select one compatible provider according to the active VoiceClaw Profile and route an invocation only to that selected active Contribution.

#### Scenario: Selected provider is active

- **WHEN** a consumer invokes a required operation and the Profile selects one compatible active provider
- **THEN** the Kernel routes the call to that provider and returns its normalized stream or result

#### Scenario: No provider is available

- **WHEN** no compatible active provider exists for a required Capability
- **THEN** the Kernel rejects invocation explicitly and does not substitute an undeclared provider

#### Scenario: Selected optional provider fails

- **WHEN** a consumer invokes a selected optional provider and that invocation fails or times out
- **THEN** the Kernel returns the normalized failure to the consumer and does not select another provider or fallback implementation

### Requirement: Content-free Relay Control State

The Kernel SHALL provide trusted Relay authority modules with a persistent `ControlStateStore` for typed grants, Host registration and revocation, Active Host Assignment generations, and Conversation Thread Mappings. The store SHALL reject conversation messages, attachments, Semantic Output, Memory content, evidence payloads, and arbitrary plugin records, and SHALL NOT be accessible directly by a plugin.

#### Scenario: Relay restarts after a successful control update

- **WHEN** a valid control-state update was acknowledged before Relay stopped
- **THEN** the next Relay process recovers the same authority version and typed control records without recovering Conversation content

#### Scenario: A control-state replacement fails

- **WHEN** validation or atomic replacement of a new control-state document fails
- **THEN** the update is not acknowledged and the previous complete valid version remains readable

#### Scenario: Concurrent authority updates arrive

- **WHEN** two trusted Relay authority modules submit valid control-state changes against the current revision
- **THEN** the store serializes both commits against the latest accepted state, advances revision monotonically, and rejects a stale expected revision instead of silently losing an update

#### Scenario: Content is submitted as control state

- **WHEN** a trusted caller or plugin attempts to store a message, attachment, Semantic Output, Memory, evidence payload, or undeclared record type
- **THEN** the store rejects the update without changing the last valid state

### Requirement: Principal and Capability Grant enforcement

The Kernel SHALL authenticate the calling Principal and require a current Capability Grant for the exact Capability Contract, operation, and Scope of every protected invocation. Secret and Workspace access SHALL be further constrained to declared references or bindings. Package installation, `requestedPermissions`, or dependency visibility SHALL NOT grant invocation authority.

#### Scenario: Capability is visible but operation is not granted

- **WHEN** a Principal can discover a registered Capability but lacks a grant for the requested operation and Scope
- **THEN** the Kernel denies invocation and records a content-minimizing audit event

#### Scenario: Secret reference is outside the grant

- **WHEN** an otherwise authorized operation asks to use an undeclared secret reference or Workspace Binding
- **THEN** the Kernel denies that resource access before invoking the Contribution

#### Scenario: Grant is revoked

- **WHEN** a grant is revoked before a protected call is accepted
- **THEN** the call fails closed without waiting for the Contribution to reconnect

### Requirement: Desktop-owned Secret broker

The Kernel SHALL mediate declared Provider-secret access through a Desktop-owned Secret broker and SHALL NOT return Provider credential material to Relay, Client, logs, the effective graph, or another plugin.

#### Scenario: Authorized Provider uses a secret

- **WHEN** an active local Provider Contribution requests a declared secret reference within its grant
- **THEN** the Desktop broker supplies only the minimum local use required by that Contribution

#### Scenario: Relay requests credential material

- **WHEN** Relay or a Client requests the underlying Provider credential value
- **THEN** the broker rejects the request and may return only a non-sensitive readiness or opaque-reference result

### Requirement: Kernel-controlled layered RPC

The Kernel SHALL wrap each cross-runtime call in a Kernel Invocation Envelope containing contract ID and version, operation, invocation identity, authenticated Principal, Scope, selected Contribution, authority generation, and trace correlation. The domain payload SHALL carry its own business identities and data.

#### Scenario: Authorized streaming call

- **WHEN** Relay invokes a granted streaming operation on an active Desktop Contribution
- **THEN** every request, stream event, cancellation, and terminal result is correlated to the same invocation identity and authority generation

#### Scenario: Unversioned or unauthorized call

- **WHEN** a cross-runtime call has no compatible contract version or valid operation-and-Scope grant
- **THEN** the Kernel rejects it before Provider execution begins

### Requirement: Harness execution contract registration

Kernel Phase 0 SHALL allow a selected Desktop Contribution to provide `harness.execution` version `1.0.0` with `provider.describe`, `thread.ensure`, `turn.start`, and `turn.cancel`. `turn.start` SHALL produce a correlated stream whose domain events identify binding, Harness Thread, Conversation Turn, Harness Execution Attempt, assignment generation, and a monotonically increasing sequence, and SHALL contain exactly one terminal outcome.

#### Scenario: Valid Harness stream

- **WHEN** `turn.start` produces ordered events for the active generation and one terminal outcome
- **THEN** Kernel forwards the provider-neutral stream to the owning Routing domain

#### Scenario: Invalid Harness stream event

- **WHEN** an event repeats a sequence, follows a terminal outcome, or carries a stale generation
- **THEN** Kernel rejects it and does not expose it as current Semantic Output

### Requirement: Private reasoning boundary

Kernel SHALL NOT expose an executor's raw private reasoning across Contribution or Relay boundaries. An authorized Feature Plugin MAY invoke a declared model-inference Capability to produce a new public structured conclusion or rationale.

#### Scenario: Provider emits raw reasoning

- **WHEN** a Provider Integration receives a Provider-native private reasoning event
- **THEN** it excludes the event before Host RPC and may emit only allowed public Semantic Output, Presentation State, bounded Outcome Evidence, or content-free diagnostics

#### Scenario: Feature requests inference

- **WHEN** a Feature Plugin has a valid grant to a model-inference operation
- **THEN** it may receive the newly produced public structured result without gaining access to another execution's private Chain of Thought

### Requirement: Inspectable effective plugin graph

The Kernel SHALL expose a secret-free graph labeled `phase: 0` containing accepted packages, Feature Plugins, Contributions, versions, runtime placement, dependency edges, selected Capability providers, grant summaries, states, operational readiness summaries, and reasons.

#### Scenario: Operator inspects a degraded graph

- **WHEN** a Provider Contribution is degraded because its local Session is unavailable
- **THEN** the graph distinguishes Contribution state from process, transport, and Session readiness without exposing paths or secrets

#### Scenario: Minimal prototype Profile has no Archive or Memory

- **WHEN** the Phase 0 Profile contains Kernel, Desktop Host, Routing, Codex, and STT/TTS providers but no Archive or Memory package
- **THEN** the Profile activates its required graph, reports those optional capabilities absent rather than failed, and does not import or instantiate their implementations

### Requirement: Phase 0 exclusion boundary

Phase 0 SHALL NOT claim support for a third-party marketplace, automatic download/update, complete signing infrastructure, general process sandboxing or WASM, hot update, cross-device plugin upgrade, general plugin-data export/uninstall/remount, complete UI Slots, arbitrary downloaded Mobile plugin code, or Archive/Memory business implementations.

#### Scenario: Package requests a deferred facility

- **WHEN** a package requires a facility outside the Phase 0 boundary
- **THEN** the Kernel reports it as unsupported rather than treating a trusted-local shortcut as the final security model

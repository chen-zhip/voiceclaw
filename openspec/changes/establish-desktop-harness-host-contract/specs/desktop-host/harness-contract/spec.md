## Purpose

Defines the provider-neutral contract through which one Desktop Host exposes local Harness Provider execution to Relay while retaining local ownership of workspaces, processes, configuration, and secrets.

## ADDED Requirements

### Requirement: Outbound authenticated Host connection
Desktop Host SHALL initiate and maintain a version-compatible outbound WSS connection to Relay using an authentication mechanism distinct from Client and Provider credentials.

#### Scenario: Remote Host enrolls and connects
- **WHEN** an authenticated Desktop owner or Client requests a short-lived one-time enrollment token and one Desktop installation exchanges it once
- **THEN** Relay issues a persistent revocable Host Credential for that Host ID, Desktop stores it in operating-system secure storage, Relay persists only its verifier and registration state, and subsequent outbound connections authenticate that Host Principal

#### Scenario: Enrollment token is reused
- **WHEN** a Host presents an expired or already consumed enrollment token
- **THEN** Relay rejects the exchange without issuing another Host Credential or changing the registered Host

#### Scenario: Bundled local Host connects
- **WHEN** Desktop starts a bundled local Relay stack
- **THEN** Desktop generates a non-persisted Local Host Bootstrap Secret, passes it through the controlled launch path to Relay and Host, and uses it to authenticate local connection and reconnect only for that stack lifetime without Relay issuing or persisting a Host Credential

#### Scenario: Remote Host credential is revoked
- **WHEN** a Host connects or requests new work with a revoked Host Credential
- **THEN** Relay rejects the connection or work without affecting Client or Provider credentials

### Requirement: Owner Host management
Remote Relay SHALL expose an owner-only Host-management interface, and Desktop settings SHALL present the registered Host ID, connection status, last activity, revoke, and re-register actions without displaying credential material.

#### Scenario: Owner revokes the registered Host
- **WHEN** the authenticated owner revokes the Phase 0 Host ID
- **THEN** Relay invalidates its Host Credential, prevents new work, and Desktop requires a new one-time enrollment to reconnect

### Requirement: Single prototype Host assignment
For Phase 0, Relay SHALL maintain at most one registered Desktop Host and one user-selected Active Host Assignment for a Logical Provider Binding, and SHALL NOT automatically select a replacement Host.

#### Scenario: User selects the active Host
- **WHEN** the registered Host reports readiness for the selected Provider and Workspace
- **THEN** Relay creates or updates its Active Host Assignment and issues a new assignment generation

#### Scenario: Active Host disconnects
- **WHEN** the Active Desktop Host disconnects
- **THEN** Relay marks its assignment unavailable and does not transfer it to another Host

#### Scenario: Relay restarts with an existing assignment
- **WHEN** Relay recovers a registered Host and Active Host Assignment from Relay Control State
- **THEN** it preserves the assignment identity and generation but reports it unavailable until that Host reconnects and reports matching readiness

### Requirement: Native ownership boundary
Relay SHALL own Logical Provider Binding, Active Host Assignment, and assignment generation, while Desktop SHALL own Workspace paths, Native Provider Configuration, Provider processes, and Provider secrets. Desktop SHALL report readiness but SHALL NOT create or replace the Relay assignment.

#### Scenario: Relay dispatches a logical binding
- **WHEN** Relay sends work for an authorized Provider and Workspace binding
- **THEN** Desktop resolves the Host-local Workspace path and Provider configuration without sending their secret material back to Relay

#### Scenario: Client asks for Provider configuration
- **WHEN** a Client displays or edits Provider settings
- **THEN** it uses the Desktop-mediated interface and receives only non-secret values allowed by the configuration Schema

### Requirement: Provider Contribution loading and readiness
Desktop Host SHALL load enabled `provider-integration` Contributions through Kernel Phase 0 and register package identity, provider ID, recognized Harness version, Capability Profile version, provided/required contracts, Contribution state, and normalized operational readiness.

#### Scenario: Contribution loads before Provider Session
- **WHEN** the package, dependencies, and grants are valid but the Provider Session is not usable
- **THEN** the Contribution can be contract-callable while process, transport, and Session readiness remain separate and the Provider Contribution reports `DEGRADED` as appropriate

#### Scenario: Settings UI remains available
- **WHEN** the Provider process is missing but its settings `client-ui` Contribution loaded successfully
- **THEN** the settings Contribution may remain `ACTIVE` while Provider readiness is unavailable

### Requirement: Local Provider process and transport lifecycle
Desktop Host SHALL start, explicitly adopt, or connect the local Harness Provider selected by its Integration Plugin and SHALL distinguish executable, process, transport, and Session readiness.

#### Scenario: Desktop starts an owned process
- **WHEN** a selected Provider requires a local process and configuration is valid
- **THEN** Desktop starts the process, observes transport readiness, and records that Desktop owns its lifecycle

#### Scenario: Desktop exits
- **WHEN** Desktop shuts down
- **THEN** it stops only Provider processes and bundled services it explicitly owns and does not terminate independently managed external processes

### Requirement: Harness execution Host projection
The Host SHALL consume the Kernel Invocation Envelope and `harness.execution@1.0.0` schemas from `@voiceclaw/contracts`, expose `provider.describe`, `thread.ensure`, `turn.start`, and `turn.cancel`, and keep Provider-native messages inside the selected Integration Plugin.

#### Scenario: Successful streaming Turn
- **WHEN** Relay invokes `turn.start` for the active binding and generation
- **THEN** Desktop returns correlated provider-neutral events with invocation, binding, Thread, Turn, Attempt, generation, increasing sequence, and exactly one terminal outcome

#### Scenario: Cancellation
- **WHEN** Relay invokes `turn.cancel` for active authorized work
- **THEN** Desktop forwards cancellation to the owning Contribution and emits no post-terminal Semantic Output

### Requirement: Assignment and stream fencing
Every Host invocation, stream event, cancellation, and terminal result SHALL carry the Active Host assignment generation, and the receiving boundary SHALL reject a stale generation, duplicate sequence, terminal-late event, or second terminal.

#### Scenario: Superseded Host reports a result
- **WHEN** a disconnected or superseded Host reports a result for an older generation
- **THEN** Relay rejects it and does not expose it to the active Conversation

### Requirement: Disconnect outcome semantics
Host or Provider disconnection SHALL produce an explicit failed outcome when non-execution is proven and `outcome-unknown` when execution may have occurred; Relay SHALL NOT automatically resend either case.

#### Scenario: Process fails before dispatch
- **WHEN** Desktop proves Provider execution did not begin
- **THEN** it reports a normalized failed outcome eligible for an explicit new Attempt

#### Scenario: Connection is lost after dispatch
- **WHEN** Relay cannot determine whether an accepted Provider request produced side effects or completed
- **THEN** it records `outcome-unknown`, preserves the original input, and does not automatically resend or switch Host

### Requirement: Phase 0 deferrals
The Host contract SHALL NOT claim multi-Host coordination, automatic failover, Native TUI Handoff, automatic Host credential rotation/recovery, third-party isolation, or general plugin installation and upgrade.

#### Scenario: Deferred operation is requested
- **WHEN** a Client requests a deferred Host operation
- **THEN** the system returns an explicit unsupported result without weakening the single-Host or authentication boundary

### Requirement: Host contract is independent of Archive and Memory
Desktop Host SHALL connect, report readiness, and serve granted Harness invocations without an Archive or Memory provider. Host registration, revocation, and assignment records SHALL remain content-free Relay Control State rather than an embedded history or Memory implementation.

#### Scenario: Minimal Host Profile starts
- **WHEN** Kernel and Desktop Host start with no Archive or Memory package installed
- **THEN** Host authentication, readiness, assignment, and `harness.execution@1` availability remain functional and neither missing optional capability marks the Host Contribution failed

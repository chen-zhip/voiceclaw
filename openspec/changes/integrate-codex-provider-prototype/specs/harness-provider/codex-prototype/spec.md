## Purpose

Defines the first real Harness Provider vertical slice: a trusted local Codex Plugin Package that implements `harness.execution@1` through Codex app-server and proves the complete Desktop microphone-to-playback path.

## ADDED Requirements

### Requirement: Codex Plugin Package composition
The system SHALL deliver Codex as one first-party local `voiceclaw.plugin.json` manifest v0 package containing exactly one Codex Feature Plugin, one `provider-integration` Contribution, and the minimum Desktop settings/selection `client-ui` Contribution. It SHALL consume provider-neutral schemas from `@voiceclaw/contracts` and SHALL NOT require or import Archive or Memory implementations.

#### Scenario: Codex package is enabled
- **WHEN** the package passes Kernel Phase 0 validation and dependencies and grants are satisfied
- **THEN** its Contributions load independently and appear in the effective graph

#### Scenario: Archive and Memory packages are absent
- **WHEN** the minimal prototype Profile enables Codex without Archive or Memory installed
- **THEN** the Codex Contributions activate and provide `harness.execution@1` without an optional-feature dependency edge or implementation import

### Requirement: Verified Codex version and schema baseline
The Codex Integration SHALL treat `codex-cli 0.153.4` as the only exactly verified prototype Capability Profile and SHALL validate its consumed app-server messages against an immutable generated JSON Schema artifact identified by generator version and SHA-256 fingerprint.

#### Scenario: Exact verified version is installed
- **WHEN** detected Codex version is `0.153.4` and the bundled schema fingerprint matches its recorded value
- **THEN** the Integration selects the exact verified profile and reports its version and schema fingerprint

#### Scenario: Installed version is not exactly verified
- **WHEN** detected Codex version differs from `0.153.4`
- **THEN** the Integration uses the nearest known profile only when profile policy permits and displays a persistent unverified-version warning

#### Scenario: Schema artifact does not match its fingerprint
- **WHEN** the immutable schema bytes do not match the recorded SHA-256
- **THEN** the Integration fails closed before app-server dispatch and reports a local integrity/configuration error

### Requirement: Native Codex configuration and availability
Desktop SHALL store and validate Codex executable location, Workspace path, non-secret preferences, and secret references and SHALL expose Contribution, executable, process, transport, and Session readiness separately.

#### Scenario: Codex is not installed
- **WHEN** the configured executable cannot be detected
- **THEN** Provider is unavailable with actionable local guidance and no dispatch occurs

#### Scenario: Codex authentication is unavailable
- **WHEN** app-server starts but cannot establish an authenticated usable Session
- **THEN** the Contribution remains inspectable/configurable, reports Session unready or degraded, and returns no credential material to Relay or Client

### Requirement: App-server process ownership and reuse
Desktop SHALL maintain at most one owned Codex app-server process for each Active Host and Native Provider Configuration tuple and SHALL reuse it across sequential mapped Threads. A materially different Native Provider Configuration SHALL use a different process identity.

#### Scenario: Sequential Threads use the same configuration
- **WHEN** two sequential mapped Threads use the same Active Host and Native Provider Configuration
- **THEN** the Integration reuses the initialized owned app-server process while retaining distinct Thread identities

#### Scenario: Configuration changes
- **WHEN** a selected binding uses a different executable, authentication context, or other process-defining Native Provider Configuration
- **THEN** Desktop does not reuse the prior process for that binding

### Requirement: Local app-server lifecycle and initialization
The Codex Integration SHALL supervise the owned local app-server through Desktop Host, use its stdio JSON-RPC transport, and complete the profile-supported initialization handshake before reporting Session ready.

#### Scenario: App-server starts successfully
- **WHEN** Codex is selected with valid configuration
- **THEN** Desktop starts or reuses the correct process, completes initialization, and reports transport and Session readiness

#### Scenario: Protocol initialization fails
- **WHEN** app-server rejects initialization or emits an incompatible response
- **THEN** the Integration drains or terminates its owned process as appropriate and reports a normalized protocol error

### Requirement: Workspace Binding and Thread reuse
The Integration SHALL implement `thread.ensure` by binding each mapped Codex Thread to the selected Host-local Workspace and creating or resuming it according to Relay's Conversation Thread Mapping.

#### Scenario: First Turn in a mapping
- **WHEN** no Codex Thread exists for the Conversation, Provider, and Workspace tuple
- **THEN** the Integration creates a Workspace-bound Codex Thread and returns its stable identity

#### Scenario: Later Turn in the same mapping
- **WHEN** the same mapping has a valid Codex Thread identity
- **THEN** the Integration reuses or resumes that Thread without selecting another Workspace

### Requirement: Input dispatch and public streamed translation
The Integration SHALL implement `turn.start` by dispatching finalized input as a Codex Turn and translating app-server notifications to provider-neutral public Semantic Output, Presentation State, bounded Outcome Evidence, usage, and terminal outcomes. Raw Provider events and raw private reasoning SHALL remain local and excluded.

#### Scenario: Codex streams an agent message
- **WHEN** app-server emits agent-message deltas for the active Turn
- **THEN** the Integration emits correlated public Semantic Output deltas under the active invocation, binding, Thread, Turn, Attempt, generation, and sequence

#### Scenario: Codex emits reasoning or tool progress
- **WHEN** app-server emits raw reasoning and command, file-change, tool, or progress Items
- **THEN** the Integration drops raw reasoning and emits only allowed Presentation State or bounded Provider-neutral Outcome Evidence for observable facts

### Requirement: Native cancellation
The Integration SHALL implement `turn.cancel` through the profile-supported Codex interruption operation and SHALL normalize the resulting terminal status.

#### Scenario: Active Codex Turn is cancelled
- **WHEN** the user cancels the active Attempt
- **THEN** the Integration interrupts the mapped Codex Turn and emits no post-terminal Semantic Output

### Requirement: Terminal outcomes and normalized errors
The Integration SHALL emit exactly one completed, failed, cancelled, or `outcome-unknown` outcome and distinguish configuration, executable, process, transport, protocol, authorization, Workspace, cancellation, and Provider execution failures.

#### Scenario: Codex Turn completes
- **WHEN** app-server reports the active Turn completed
- **THEN** the Integration maps it to one normalized terminal with matching identities, generation, and sequence

#### Scenario: Transport dies after dispatch
- **WHEN** transport closes after Turn dispatch and completion cannot be established
- **THEN** the Integration reports `outcome-unknown` and does not restart and replay the Turn automatically

### Requirement: Desktop configuration and selection UI
Desktop SHALL let the user configure non-secret Codex settings, inspect exact/unverified profile and readiness, select Codex and a Workspace for STT/TTS Harness, and repair invalid configuration without exposing secrets.

#### Scenario: User selects Codex
- **WHEN** the package is active and Provider Session ready
- **THEN** Desktop allows Codex selection for a Workspace and shows the Relay-owned Logical Provider Binding and Active Host Assignment state

### Requirement: Real-Harness end-to-end acceptance
Acceptance SHALL require a real installed/authenticated Codex app-server to process finalized Desktop microphone input and produce public Semantic Output that Relay converts to TTS audio and Desktop begins to play while the acceptance Profile contains no Archive or Memory package.

#### Scenario: Opt-in real app-server system test
- **WHEN** the opt-in environment supplies real Codex authentication and test STT/TTS credentials
- **THEN** an automated disposable-Workspace test traverses the production contract boundaries without Archive or Memory and records non-secret version, schema fingerprint, identities, effective graph, and terminal evidence

#### Scenario: Physical Desktop voice Turn
- **WHEN** a user speaks through the physical Desktop microphone with Codex and a valid Workspace selected
- **THEN** Relay finalizes STT, real app-server executes the mapped Turn, public Semantic Output streams, Relay synthesizes TTS, and Desktop begins audible playback without Archive or Memory

#### Scenario: Fixture-only execution
- **WHEN** deterministic contract tests pass but neither real app-server acceptance nor the physical journey completes
- **THEN** the Codex change remains unaccepted

### Requirement: Provider-specific locality
All Codex version, schema, method, event, configuration, process-profile, and Capability Profile branches SHALL remain inside the Codex `provider-integration` Contribution.

#### Scenario: Generic component consumes Codex output
- **WHEN** Kernel, Relay Routing, Desktop Host, or Client processes a Codex-backed Turn
- **THEN** it uses provider-neutral contracts and identities without branching on `codex`

### Requirement: Prototype Provider deferrals
This change SHALL NOT claim History Import, Native TUI Handoff, complete Approval Route, general recovery/rollback, or support for any non-Codex Provider.

#### Scenario: Deferred Codex operation is requested
- **WHEN** a user requests a deferred Codex operation
- **THEN** the Integration reports it unsupported through its static Capability Profile

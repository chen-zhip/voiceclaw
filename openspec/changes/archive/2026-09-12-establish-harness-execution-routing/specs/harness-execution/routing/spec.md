## Purpose

Defines provider-neutral routing of finalized speech through one Desktop-hosted Harness execution and back through Relay TTS, including identities, persistent control-plane mapping, fencing, optional capabilities, cancellation, outcomes, and explicit recovery choices.

## ADDED Requirements

### Requirement: Explicit STT/TTS Harness selection

The Client SHALL explicitly select the STT/TTS Harness Conversation Pipeline, Provider, and Workspace before Relay dispatches finalized text and SHALL NOT silently select a Provider or another Pipeline.

#### Scenario: Selected binding is ready

- **WHEN** the user selects STT/TTS Harness and a ready Provider/Workspace binding
- **THEN** Relay accepts finalized STT text for Harness dispatch

#### Scenario: Selected Provider is unavailable

- **WHEN** the selected Provider or Active Host Assignment is unavailable
- **THEN** Relay preserves input and offers explicit retry, Provider reselection, or return-to-S2S choices without dispatching elsewhere

### Requirement: One active Harness Turn per Conversation

Relay SHALL allow at most one active Harness Turn per Conversation and SHALL preserve later accepted inputs in visible serial order.

#### Scenario: A second input arrives

- **WHEN** a Harness Turn is active and another finalized input is accepted
- **THEN** Relay keeps the later input pending and does not dispatch it concurrently

### Requirement: Stable Turn and Attempt identity

Relay SHALL assign a stable Conversation Turn identity and a distinct Harness Execution Attempt identity for each explicit dispatch.

#### Scenario: User retries a known failed Turn

- **WHEN** the user explicitly retries preserved input after a proven pre-dispatch failure
- **THEN** Relay retains the Turn identity, creates a new Attempt, and rejects events from the earlier Attempt

#### Scenario: User retries an Outcome Unknown

- **WHEN** the user acknowledges that Provider side effects may already have occurred and explicitly retries preserved input
- **THEN** Relay creates a new Attempt without reopening or changing the terminal outcome of the prior Attempt

### Requirement: Persistent Conversation Thread Mapping

Relay SHALL persist the mapping from `(conversationId, providerId, workspaceId)` to a Harness Thread identity as typed Relay Control State through Kernel's `ControlStateStore`, independent of Conversation Archive. The mapping SHALL contain identity data but no message content, attachment, Semantic Output, Memory content, or evidence payload.

#### Scenario: Conversation continues in the same binding

- **WHEN** a later Turn uses the same Conversation, Provider, and Workspace
- **THEN** Relay dispatches it through the existing valid Harness Thread Mapping

#### Scenario: Provider or Host becomes unavailable

- **WHEN** the Provider is disabled, the Host is offline, or an update temporarily removes readiness
- **THEN** Relay retains the mapping as dormant and does not delete the Provider-owned Thread

#### Scenario: Workspace Binding is deleted

- **WHEN** a Workspace Binding is deleted
- **THEN** its mappings become dormant and the UI offers an explicit Forget Thread Mapping action

#### Scenario: User forgets a mapping

- **WHEN** the user confirms Forget Thread Mapping
- **THEN** Relay deletes only the VoiceClaw mapping pointer and never deletes the Provider-owned Thread

#### Scenario: Conversation is explicitly deleted

- **WHEN** the owning VoiceClaw Conversation is explicitly deleted
- **THEN** Relay removes its Thread Mappings without deleting Provider-owned Threads

#### Scenario: Mapping persistence fails

- **WHEN** Relay cannot atomically commit a new or changed Conversation Thread Mapping
- **THEN** it preserves the prior valid mapping state, does not acknowledge the new mapping, and does not persist the Conversation input as a substitute

### Requirement: Finalized STT dispatch through harness.execution

Relay SHALL dispatch only finalized recognized text through `harness.execution@1.0.0` using `thread.ensure` and `turn.start` under the active binding and generation.

#### Scenario: STT emits partial text

- **WHEN** STT emits a partial recognition update
- **THEN** Relay may display it but does not invoke `turn.start`

#### Scenario: Harness emits normalized stream events

- **WHEN** the active Attempt emits allowed Semantic Output, Presentation State, Outcome Evidence, or usage
- **THEN** Relay routes each event under the matching invocation, binding, Thread, Turn, Attempt, generation, and sequence without changing the Harness conclusion

#### Scenario: Harness attempts to expose private reasoning

- **WHEN** a Host stream contains raw private reasoning or an unrecognized private output class
- **THEN** Relay rejects it rather than forwarding it to TTS, Client, Archive, Memory, or another Feature Plugin

### Requirement: Active Host and stream fencing

Relay SHALL accept events and terminal outcomes only when invocation, binding, Thread, Turn, Attempt, generation, and sequence satisfy the active dispatch and exactly one terminal outcome is produced.

#### Scenario: Invalid stream event arrives

- **WHEN** an event has a stale generation, duplicate sequence, follows the terminal, or is a second terminal
- **THEN** Relay rejects it and does not send it to TTS or Client presentation

### Requirement: TTS delivery and Desktop playback

Relay SHALL synthesize normalized public Harness speech through the selected TTS boundary and Desktop SHALL play returned audio while retaining streamed screen Semantic Output.

#### Scenario: First speech unit is available

- **WHEN** Relay receives a complete streamable speech unit from the active Attempt
- **THEN** Relay submits it to TTS and streams synthesized audio to the originating Desktop Client

### Requirement: Explicit cancellation and terminal outcome

The user SHALL be able to cancel the active Attempt through `turn.cancel`, and Relay SHALL expose exactly one normalized completed, failed, cancelled, or `outcome-unknown` terminal outcome.

#### Scenario: User cancels an active Attempt

- **WHEN** Desktop sends an authorized cancellation for the active Turn
- **THEN** Relay invokes `turn.cancel` and rejects Semantic Output after the accepted terminal outcome

### Requirement: No automatic replay or failover

Relay SHALL NOT automatically resend failed or `outcome-unknown` work and SHALL NOT silently switch Provider, Host, or Pipeline.

#### Scenario: Host connection is lost after dispatch

- **WHEN** Relay cannot prove whether the Provider completed or produced side effects
- **THEN** Relay preserves input, marks `outcome-unknown`, explains the risk, and requires a user decision before a new Attempt

### Requirement: Archive is an optional Capability

Routing SHALL call `archive.append` only when a compatible active Archive provider and grant exist. Archive SHALL be resolved as an optional runtime Capability rather than a required activation dependency. Absence of Archive SHALL leave message content scoped to the current Relay Session and potentially lost after restart; persistent content-free Thread Mapping does not become Conversation history.

#### Scenario: Archive is absent

- **WHEN** no compatible Archive provider is active
- **THEN** the live Conversation continues without durable message content, and Client SQLite, Tracing, Brain storage, and Thread Mapping do not become history authority

#### Scenario: Authorized Archive append fails

- **WHEN** an active authorized Archive provider rejects, times out, or disconnects while accepting a visible event
- **THEN** Routing exposes an explicit non-persistent or degraded feature result, continues the Harness Turn and public TTS/Client output, preserves the Harness terminal outcome, and does not select another Archive provider or storage fallback

### Requirement: Memory is an optional Capability

Routing SHALL retrieve or include Memory only when compatible active Memory Capabilities and grants exist. Memory SHALL be resolved as an optional runtime Capability rather than a required activation dependency. Absence of Memory SHALL remove retrieval, production, inclusion, and controls without invoking legacy transcript-to-Brain `remember` behavior.

#### Scenario: Memory is absent

- **WHEN** no compatible Memory Feature Plugin is active
- **THEN** Relay dispatches the ordinary Harness Turn without Memory context and Desktop shows no Memory controls

#### Scenario: Authorized Memory retrieval fails

- **WHEN** the selected Memory provider rejects, times out, or disconnects before Harness dispatch
- **THEN** Routing exposes explicit Memory degradation and dispatches the ordinary Harness Turn without Memory context, another Memory provider, transcript reconstruction, or Brain fallback

#### Scenario: STT/TTS Harness Session closes without Memory

- **WHEN** an STT/TTS Harness Relay Session closes while no active authorized Memory provider exists
- **THEN** Relay does not call transcript-to-Brain `remember`, `syncTranscriptToBrain`, or an equivalent hidden persistence path

### Requirement: Routing acceptance is provider-neutral

This change SHALL be accepted against a deterministic implementation of `harness.execution@1`; it SHALL NOT claim that a real Harness Provider has passed end-to-end acceptance.

#### Scenario: Deterministic fixture completes the Desktop route

- **WHEN** the fixture emits normalized public output through the Host contract
- **THEN** Routing may prove STT-final dispatch, stream routing, TTS submission, and Desktop playback observation with no Archive or Memory package installed and without introducing a Provider-name branch

#### Scenario: No real Provider has passed

- **WHEN** Routing fixtures pass but no real Harness has completed the physical journey
- **THEN** this Routing change may complete, while the Codex Provider change and overall prototype remain unaccepted

### Requirement: Prototype deferrals

The Routing contract SHALL NOT claim Native TUI Handoff, complete Approval Route, multi-Client arbitration, complex queue editing, or Provider-native recovery and rollback.

#### Scenario: Deferred routing feature is requested

- **WHEN** a user requests a deferred routing feature
- **THEN** the system reports it unavailable and preserves executor and ownership boundaries

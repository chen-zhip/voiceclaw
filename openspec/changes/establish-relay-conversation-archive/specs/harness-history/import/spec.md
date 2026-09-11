## Purpose

Defines provider-neutral, one-way ingestion by an authorized VoiceClaw Integration Plugin's `provider-integration` Contribution into the active Archive Feature Plugin while preserving source identity, retry safety, user deletion, and Provider ownership.

## ADDED Requirements

### Requirement: Harness History Import is one-way
The system SHALL import supported Harness Thread history into the Conversation Archive without editing, deleting, or claiming authority over the Provider-owned source.

#### Scenario: Provider Thread is imported
- **WHEN** an authorized `provider-integration` Contribution imports a supported Harness Thread through `archive.import`
- **THEN** Relay creates or updates Archive records while leaving the Provider Thread unchanged

#### Scenario: Archived import is edited locally
- **WHEN** a user changes VoiceClaw metadata or deletes an imported External Conversation
- **THEN** the system does not propagate that change back to the Harness Provider

### Requirement: Stable Provider source identity controls deduplication
The system SHALL identify imported sources by Provider, Workspace, Harness Thread, source event, and source revision identities supplied through the provider-neutral import contract.

#### Scenario: Source event is imported again
- **WHEN** an integration repeats an event with the same stable source and revision identities
- **THEN** Relay recognizes the existing import without creating a duplicate event

#### Scenario: Source event receives a new revision
- **WHEN** an integration reports a new revision identity for an existing source event
- **THEN** Relay preserves the revision relationship and current imported representation without erasing provenance

### Requirement: External Conversations are not heuristically merged
The system SHALL keep an imported Harness Thread as an External Conversation unless an explicit VoiceClaw Conversation mapping names it.

#### Scenario: Import has an explicit Conversation mapping
- **WHEN** an import carries a valid mapping to an existing VoiceClaw Conversation for the same Provider and Workspace context
- **THEN** Relay associates the imported source events with that mapped Conversation

#### Scenario: Import has no explicit mapping
- **WHEN** an imported Thread resembles an existing Conversation only by content, title, or time
- **THEN** Relay creates or updates a distinct External Conversation keyed by stable Provider, Workspace, and Thread identity

### Requirement: Automatic import requires stable identities
The system SHALL enable resumable or automatic Harness History Import only when the Provider integration supplies stable Thread, event, and revision identities.

#### Scenario: Provider has stable identities
- **WHEN** an authorized integration declares and supplies the required stable identities
- **THEN** Relay permits cursor-based resumable synchronization according to its Capability Profile

#### Scenario: Provider lacks stable identities
- **WHEN** an integration cannot supply the required stable identities
- **THEN** Relay permits only a warned one-shot manual import and does not offer automatic synchronization

### Requirement: Import cursors are durable and idempotent
The system SHALL persist import cursor progress and allow retries without duplicating accepted source events.

#### Scenario: Import page succeeds
- **WHEN** Relay accepts every valid event in an import page
- **THEN** it advances the durable cursor only through the accepted source range

#### Scenario: Import page partially fails
- **WHEN** some source events fail validation or payload transfer
- **THEN** Relay reports each failed source identity, retains accepted events, and does not advance the cursor past unresolved source work

#### Scenario: Import resumes after interruption
- **WHEN** the integration reconnects with the last committed cursor
- **THEN** Relay resumes from that cursor and accepts repeated source identities idempotently

### Requirement: Import discovery is content-free before authorization
The system SHALL allow eligible integrations to discover importable source and synchronization metadata without receiving Thread content before content access is authorized.

#### Scenario: Integration lists import sources
- **WHEN** an installed and enabled `provider-integration` Contribution requests import discovery through its granted Archive Capability
- **THEN** it receives Provider, Workspace, time coverage, content-type, and synchronization metadata without message text or attachment payloads

### Requirement: Import Suppression prevents deleted content from returning
The system SHALL retain minimum content-free Import Suppression for a user-deleted External Conversation and reject later automatic re-import of the same source identity.

#### Scenario: User deletes an External Conversation
- **WHEN** Relay commits deletion of an imported External Conversation
- **THEN** it records Import Suppression before acknowledging deletion and removes the content from authorized Archive reads

#### Scenario: Synchronization encounters suppressed source
- **WHEN** a later automatic import presents the same Provider, Workspace, and Thread identity
- **THEN** Relay does not recreate the deleted External Conversation or its content

#### Scenario: User explicitly imports suppressed source again
- **WHEN** the user deliberately requests a new manual import of a suppressed source
- **THEN** Relay requires an explicit decision to remove or override the suppression before accepting content

### Requirement: Import does not imply Memory Inclusion
The system SHALL complete Harness History Import independently of Agent Memory and SHALL NOT automatically include imported content in Memory Production.

#### Scenario: Thread is imported without Memory Inclusion
- **WHEN** an authorized import does not carry a separately approved Memory Inclusion request
- **THEN** Relay archives the External Conversation without producing Memory Candidates or changing Memory policy

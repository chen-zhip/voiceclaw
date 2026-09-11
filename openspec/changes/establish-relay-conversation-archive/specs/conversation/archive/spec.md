## Purpose

Defines Relay's authoritative, privacy-bounded record of VoiceClaw conversations and the access, attachment, deletion, and provenance behavior shared by all Clients and Conversation Pipelines.

## ADDED Requirements

### Requirement: Archive is provided through a replaceable Feature Plugin
The system SHALL expose Conversation Archive behavior through versioned Archive Capability Contracts supplied by an active Archive Feature Plugin, while VoiceClaw Kernel enforces identity, authorization, data ownership, deletion, audit, migration, and fencing invariants independently of the selected implementation.

#### Scenario: Default distribution enables Archive
- **WHEN** the default VoiceClaw Profile starts with the official Archive Feature Plugin enabled
- **THEN** its Relay Archive Authority Contribution provides the sole cross-Client history authority through Kernel-controlled Capability Contracts

#### Scenario: Another feature consumes Archive
- **WHEN** an authorized Feature Plugin needs Archive content or evidence
- **THEN** it invokes the applicable Archive Capability Contract with a scoped Capability Grant and cannot open Archive storage directly

#### Scenario: Archive Feature Plugin is absent
- **WHEN** VoiceClaw runs without an active Archive Feature Plugin
- **THEN** non-persistent realtime Conversation may continue while cross-device history, Archive search, import, Client Projection synchronization, and Archive Evidence resolution are explicitly unavailable

### Requirement: Relay is the Conversation Archive authority
The system SHALL treat the Relay Conversation Archive as the sole cross-Client authority for conversation history produced through every Conversation Pipeline.

#### Scenario: Relay accepts a conversation event
- **WHEN** an authenticated Client submits a conversation event and Relay accepts it
- **THEN** Relay assigns authoritative Archive identity and ordering before the event is synchronized to Client Projections

#### Scenario: Client state conflicts with Relay
- **WHEN** a Client Projection contains history that conflicts with authoritative Archive state
- **THEN** the system restores the projection from Relay without changing the authoritative Archive to match the Client cache

### Requirement: Archive events preserve identity and provenance
The system SHALL give every archived source event immutable identity and structured Conversation Origin sufficient to distinguish VoiceClaw events from named external Provider and thread events.

#### Scenario: VoiceClaw event is archived
- **WHEN** Relay accepts an event produced through a VoiceClaw Conversation
- **THEN** the archived event records a structured VoiceClaw origin rather than an inferred boolean source flag

#### Scenario: External Provider event is archived
- **WHEN** a Harness History Import adds an external event
- **THEN** the archived event preserves its Provider, Workspace, Harness Thread, source event, and source revision identities

#### Scenario: Existing event content changes
- **WHEN** an authorized source reports a new revision of an already archived source event
- **THEN** Relay records the revision relationship without silently mutating the original source-event identity

### Requirement: Archive content has explicit privacy boundaries
The system SHALL store normalized user-visible conversation text and supported user-visible attachments while excluding raw microphone audio, synthesized speech, private reasoning, summaries derived solely from private reasoning, full Provider wire payloads, and tracing content by default.

#### Scenario: Normal conversation output is archived
- **WHEN** a Conversation produces user-visible text through any Conversation Pipeline
- **THEN** Relay archives the normalized text without requiring the Provider's raw transport payload

#### Scenario: Excluded content is produced
- **WHEN** a Conversation produces raw audio, private reasoning, a summary derived solely from private reasoning, or content-bearing tracing data
- **THEN** the Conversation Archive does not persist that content as conversation history

#### Scenario: Executor provides a user-visible rationale
- **WHEN** an executor includes a concise rationale in user-visible Semantic Output
- **THEN** Relay archives it as ordinary assistant text without classifying it as stored private reasoning

#### Scenario: Tracing data is unavailable
- **WHEN** archived content must be synchronized or restored
- **THEN** the system does not use the Tracing Collector as an Archive source

### Requirement: Archive attachments remain referentially correct
The system SHALL preserve supported attachments by content identity, avoid duplicate original payload storage, and distinguish a missing payload from an attachment that never existed.

#### Scenario: Identical images are archived more than once
- **WHEN** multiple archived messages reference byte-identical supported images
- **THEN** Relay may expose each message attachment while retaining only one content-addressed original payload

#### Scenario: Imported Desktop Message Attachment exists
- **WHEN** Desktop migration imports a persisted Desktop Message Attachment whose local payload is readable
- **THEN** Relay preserves the original payload and its message association

#### Scenario: Imported Desktop Message Attachment is missing
- **WHEN** Desktop migration imports a persisted Desktop Message Attachment whose local payload cannot be read
- **THEN** Relay records an attachment-unavailable state without inventing or silently omitting the attachment

#### Scenario: Projection thumbnail is evicted
- **WHEN** a Client removes an evictable local thumbnail from its bounded cache
- **THEN** the authoritative original attachment and message association remain available from Relay

### Requirement: Archive Catalog does not disclose conversation content
The system SHALL provide authorized integrations with an Archive Catalog containing only source, Workspace, time coverage, content-type, and synchronization metadata.

#### Scenario: Integration inspects the Archive Catalog
- **WHEN** an installed and enabled integration requests the Archive Catalog
- **THEN** it can discover available Archive scopes without receiving conversation text, attachment payloads, or private metadata

### Requirement: Archive content access is scoped and auditable
The system SHALL enforce persistent, revocable, and audited Archive Access Grants, represented through Kernel Capability Grants, for Feature Plugin and integration access to conversation content.

#### Scenario: Integration reads an allowed scope
- **WHEN** an integration presents a valid grant for named Archive sources or Workspaces
- **THEN** Relay returns only content and attachments inside that grant and records the access

#### Scenario: Integration requests full Archive access
- **WHEN** an integration requests content across the entire Conversation Archive
- **THEN** Relay requires an explicit `archive.read.all` grant and records the request and result separately

#### Scenario: Archive grant is revoked
- **WHEN** the user revokes an Archive Access Grant
- **THEN** subsequent reads and searches using that grant are denied without waiting for the integration to reconnect

#### Scenario: Memory permission is presented for raw Archive search
- **WHEN** an executor has Memory read permission but lacks `archive.search` permission
- **THEN** Relay denies access to raw transcript search and attachment content

### Requirement: Archive deletion takes effect before acknowledgment
The system SHALL make an authorized Archive deletion unavailable to reads, searches, and new projection synchronization before reporting the deletion as successful.

#### Scenario: User deletes an archived conversation
- **WHEN** Relay commits an authorized deletion
- **THEN** new reads and searches exclude its content and Client Projections receive authoritative deletion state

#### Scenario: Physical payload cleanup is incomplete
- **WHEN** content and attachment cleanup continues after logical deletion
- **THEN** stale indexes or caches cannot make the deleted content readable

#### Scenario: Unreferenced attachment is purged
- **WHEN** deletion removes the final Archive reference to a content-addressed attachment
- **THEN** Relay eventually removes its live payload after preserving the minimum content-free deletion state

### Requirement: Archive and Agent Memory remain separate
The system SHALL NOT treat archived conversation content as Agent Memory unless a separately authorized Memory Inclusion flow accepts it as Memory Evidence.

#### Scenario: Conversation is archived normally
- **WHEN** Relay archives or imports conversation content without Memory Inclusion
- **THEN** the content remains available only under Archive permissions and does not become an Agent Memory entry

#### Scenario: Executor has Memory access only
- **WHEN** an executor may search Agent Memory but has no Archive content grant
- **THEN** it cannot retrieve raw conversation events or complete Memory Evidence through the Archive API

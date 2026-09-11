## Purpose

Defines how Desktop and Mobile mirror Relay-authoritative conversations, behave while disconnected, and migrate their existing local histories without becoming competing history authorities.

## ADDED Requirements

### Requirement: Client history is a disposable projection
The system SHALL treat Relay-derived data in Desktop and Mobile conversation databases as rebuildable Client Projections of Relay Archive state after migration. Local drafts and outbox entries SHALL remain distinguishable from the projection.

#### Scenario: Client installs with an empty projection
- **WHEN** an authenticated Client connects without local conversation history
- **THEN** it can rebuild the visible history allowed to that Client from Relay

#### Scenario: Projection is corrupt or discarded
- **WHEN** a Client Projection is reset because it is stale, corrupt, or over its storage limit
- **THEN** authoritative Archive history remains unchanged and the Client can synchronize it again

#### Scenario: Projection is reset with local work present
- **WHEN** a Client resets its rebuildable projection while drafts or outbox entries exist
- **THEN** it preserves those local entries outside the projection and does not represent them as authoritative Archive events

### Requirement: Relay acceptance defines an authoritative write
The system SHALL distinguish local drafts and outbox entries from authoritative conversation events until Relay accepts them.

#### Scenario: Online submission succeeds
- **WHEN** a Client submits a conversation event with a stable Client Submission identity and Relay accepts it
- **THEN** the Client replaces its local submission state with the authoritative Archive identity and ordering

#### Scenario: Submission response is lost
- **WHEN** a Client retries the same Client Submission identity after an uncertain response
- **THEN** Relay returns the existing accepted result or accepts it once without creating duplicate authoritative events

### Requirement: Disconnected Clients cannot rewrite Archive history
The system SHALL allow disconnected Clients to read cached history and create local drafts or outbox entries without representing those changes as authoritative Archive state.

#### Scenario: Client reads while disconnected
- **WHEN** Relay is unreachable and the requested conversation exists in the Client Projection
- **THEN** the Client displays the cached conversation as offline-readable content

#### Scenario: Client composes while disconnected
- **WHEN** the user creates a message while Relay is unreachable
- **THEN** the Client preserves it as a visibly local draft or outbox entry until Relay accepts or rejects it

#### Scenario: Offline submission is rejected later
- **WHEN** Relay rejects an outbox entry after reconnection
- **THEN** the Client keeps the local content with actionable rejected status and does not insert it into authoritative history

### Requirement: Projection synchronization is ordered and resumable
The system SHALL synchronize authoritative events and tombstones in a stable order using a Relay-issued, opaque, resumable Archive Cursor.

#### Scenario: Synchronization is interrupted
- **WHEN** a Client disconnects after applying only part of a synchronization page
- **THEN** it resumes from its last committed Archive Cursor without losing or duplicating authoritative events

#### Scenario: Deletion occurred on another Client
- **WHEN** a Client synchronizes a Relay tombstone created elsewhere
- **THEN** it removes the corresponding readable payload from its projection and preserves the authoritative deletion state

#### Scenario: Archive Cursor is invalid or no longer resumable
- **WHEN** Relay rejects a Client's Archive Cursor as invalid or outside the resumable range
- **THEN** Relay requires a projection reset, and the Client preserves local drafts and outbox entries while rebuilding Relay-derived data from an authorized full synchronization

### Requirement: Existing local history migrates once by source identity
The system SHALL import still-existing Desktop and Mobile records using a Source Record Identity composed of source system, stable Source Installation ID, source record type, and source record ID.

#### Scenario: Local database begins migration
- **WHEN** an existing local database has no Source Installation ID
- **THEN** the Client establishes and persists one stable identity for that database lineage before submitting source records

#### Scenario: Migration is restarted
- **WHEN** a Client repeats migration after interruption
- **THEN** records already accepted under the same source identity are not duplicated and remaining records continue importing

#### Scenario: Two installations reuse local numeric IDs
- **WHEN** Desktop or Mobile installations contain records with the same local record ID
- **THEN** Relay preserves them as distinct source records because their source installation IDs differ

#### Scenario: Record types reuse a local numeric ID
- **WHEN** a conversation, message, or attachment in one installation has the same local numeric ID
- **THEN** Relay preserves them as distinct source records because their source record types differ

#### Scenario: Similar local conversations exist
- **WHEN** records from different installations have similar titles, timestamps, or content without shared stable identity
- **THEN** Relay does not heuristically merge them

#### Scenario: Old local ID is absent
- **WHEN** migration observes a gap in local numeric IDs or a record deleted before migration
- **THEN** Relay neither reconstructs the missing content nor fabricates a tombstone for it

### Requirement: Migration failures are recoverable and visible
The system SHALL checkpoint migration progress and expose record-level failures without discarding successfully imported records.

#### Scenario: One migration record fails
- **WHEN** a local record or Desktop Message Attachment cannot be imported while other records are valid
- **THEN** Relay retains successful imports, reports the failed source identity, and permits an idempotent retry

#### Scenario: Migration completes
- **WHEN** every still-existing record is imported or explicitly reported as failed or unavailable
- **THEN** the Client marks the one-time migration state complete and begins using its database only as a Client Projection

### Requirement: Client projection storage is bounded
The system SHALL allow Clients to evict old text pages, thumbnails, and other reconstructible projection data without deleting Relay Archive content.

#### Scenario: Projection exceeds its local storage bound
- **WHEN** a Client evicts least-recently-used reconstructible data
- **THEN** the data remains available through later Relay synchronization and is not reported as an Archive deletion

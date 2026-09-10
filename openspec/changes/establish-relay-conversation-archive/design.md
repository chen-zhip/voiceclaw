## Context

See `proposal.md` for motivation and the three delta specs for externally observable behavior. Today Desktop and Mobile each persist conversations in a local SQLite database and pass selected history back to Relay as session configuration. Relay has no durable conversation store: `history.ts` builds an execution-time context summary, and `RelaySession` can send a cleanup prompt to the Brain gateway, but neither path is an Archive authority or an acceptable Agent Memory implementation.

Desktop already persists `conversations`, `messages`, and image-only `message_attachments`; attachments up to 5 MiB are inline and larger attachments up to 10 MiB are file-backed. Mobile persists conversations and messages but no message attachments. Relay is an independently deployable Node service with Express and WebSocket entry points, while Desktop may supervise it as a separate process. The design therefore cannot share a Client database, filesystem path, or Electron-native database connection with Relay.

The Archive must support three writers without creating multiple authorities: Relay-owned live Conversation Pipelines, one-time Client migration, and provider-neutral Harness History Import. It must also support rebuildable Client Projections, scoped integration reads, logical deletion before acknowledgment, and later Agent Memory provenance without storing private reasoning.

ADR-0009 places this behavior in the default official Archive Feature Plugin. The Feature Plugin composes a Relay Archive Authority/Storage Contribution, Archive Search, Import, Client Projection, and Desktop/Mobile UI Contributions. VoiceClaw Kernel supplies manifest and lifecycle enforcement, Principal resolution, Capability Grants, controlled RPC, data namespaces, audit, version negotiation, migration coordination, and deletion/ownership invariants. This design specifies the default Archive implementation behind those seams; it does not make the implementation part of an irreplaceable Kernel.

## Goals / Non-Goals

**Goals:**

- Give Relay one transactional Archive application boundary used by live conversations, Client migration, and Harness imports.
- Implement the boundary as the official Archive Feature Plugin while keeping the public Archive Capability Contracts replaceable and provider-neutral.
- Preserve immutable event/source identity while providing efficient current-conversation reads, ordered projection synchronization, deletion, and scoped search.
- Keep Relay deployable both as a Desktop-supervised personal service and as an external service with its own durable volume.
- Make retries safe across lost responses, process restarts, partial migrations, attachment transfer, and provider import pages.
- Minimize authoritative storage by normalizing visible text once, deduplicating original attachment bytes, and treating projections and indexes as rebuildable.

**Non-Goals:**

- Producing, retrieving, or injecting Agent Memory or Decision Context. Those belong to `establish-relay-agent-memory` and may reference Archive evidence.
- Persisting Harness runtime state, Provider wire payloads, raw audio, synthesized audio, tracing payloads, local Thinking Storage, or private Chain of Thought.
- Editing or deleting a Provider-owned Harness Thread.
- Defining multi-user account tenancy, automatic Provider failover, or executable Harness recovery.
- Retaining legacy Client summaries as authoritative history. They are derived execution/projection data and can be regenerated.
- Defining the general Plugin Manifest, third-party isolation, cross-device plugin upgrade, or uninstall-data protocols. Those belong to `establish-voiceclaw-feature-plugin-kernel` and are prerequisites for implementation tasks.

## Decisions

### 0. Preserve the Archive change on the deferred Feature Plugin path

The Archive proposal and delta specs remain the source of truth for conversation identity, authority, privacy, projection, import, and deletion. Splitting those semantics into the Kernel change would couple a generic plugin runtime to one feature and make alternative Archive providers reproduce undocumented behavior.

`establish-voiceclaw-feature-plugin-kernel` is therefore a planning and implementation prerequisite, but not the owner of Archive domain semantics. Archive does not block the non-persistent Desktop Harness prototype: Routing invokes `archive.append` only when the Capability is installed and granted. This change will not create or finalize `tasks.md` until Kernel Phase 0 is reviewed and the later Archive-specific Capability, data namespace, migration, lifecycle, and deletion contracts are ready. Once available, Archive tasks will implement the official Plugin Package against them.

### 1. Put one Archive application service behind three ingestion ports

The official Archive Feature Plugin will provide an `ArchiveService` through its Relay Contribution, with explicit ports for live VoiceClaw events, Client migration/submission, and Harness History Import. All three ports call the same validation, identity, authorization, transaction, change-feed, and deletion logic. Live Relay sessions invoke the `archive.append` Capability Contract; Clients and Desktop-hosted Integration Plugins use Kernel-controlled authenticated network APIs.

This is preferred over writing Archive rows directly from `RelaySession`, migration routes, and Provider plugins because separate writers would drift on privacy filtering, idempotency, and tombstone ordering. It is also preferred over making Desktop the storage bridge because ADR-0004 requires an independently deployable Relay boundary.

The service is split into deep internal modules rather than one route-oriented module:

- `archive-domain`: normalized event, origin, source identity, revision, attachment, grant, and deletion invariants;
- `archive-application`: commands, queries, import/migration coordinators, and transaction boundaries;
- `archive-store`: metadata, change feed, search index, and durable work queues;
- `archive-blob-store`: content-addressed attachment staging, verification, reads, and garbage collection;
- `archive-api`: authenticated Client, catalog, grant, sync, blob, and import transports.

### 2. Use a Relay-resident, plugin-namespaced relational metadata store and content-addressed blob store

The official Archive implementation uses a SQLite metadata database in WAL mode and a sibling filesystem blob directory inside its Kernel-managed Relay data namespace. The storage interfaces remain explicit so a later Archive Capability provider can use PostgreSQL and object-store adapters without changing domain or API contracts. Desktop, Mobile, and other plugins never open these stores directly.

SQLite is selected over JSON files because acceptance, source deduplication, current-state updates, tombstone publication, audit records, and durable work enqueueing must commit atomically. An external-only database is rejected because a bundled personal Relay must run without another service. The exact Node SQLite driver is an implementation/package decision, but it must run in the standalone Relay process and must not open or reuse Desktop's Electron SQLite database.

The core relations are:

- Archive conversations and their structured origin/current metadata;
- immutable logical events, append-only revision identity/relationship metadata, and the current readable revision payload;
- unique VoiceClaw source identities, Provider source identities, and Client Submission identities;
- attachment records, message associations, verified blob identities, and unavailable markers;
- a globally ordered Archive change feed and retained tombstones;
- projection/import/migration checkpoints and record-level failures;
- Archive Access Grants, content-free access audit records, and Import Suppression;
- a derived full-text index and durable attachment garbage-collection queue.

Opaque server-generated IDs identify conversations, events, revisions, attachments, and submissions. A transactional monotonically increasing `change_sequence` provides synchronization order; timestamps never determine authority or deduplication.

### 3. Separate immutable source events, revisions, and the current read model

A source event identity never changes. If a Provider reports a new source revision, Relay appends revision identity and relationship metadata linked to that source event and updates the current read model in the same transaction. It does not overwrite the prior revision identity or allocate a second logical message. VoiceClaw-authored events normally have one revision, but the same model permits explicit future corrections without changing identity.

By default, only the current revision retains a complete readable payload. Superseded revisions retain content-free identity, relationship, source revision, timestamp, and content digest metadata; their complete text or attachment payload is purged unless an explicit retention policy requires it. This preserves revision provenance without turning revision history into an unbounded second transcript store.

Every accepted mutation appends an Archive change after updating the current read model. Projection consumers read the current representation plus its revision identity; forensic or provenance reads can follow the revision relationship when authorized. This avoids treating an event log as the only query model while still preserving the source history required by the specs.

### 4. Expose Archive Capability Contracts over HTTP with shared Kernel authentication

Archive metadata, synchronization, catalog, grant management, imports, and attachment streaming use versioned HTTPS endpoints under `/v1/archive` as the network projection of Archive Capability Contracts. Large attachment payloads do not use the existing `/ws` session channel because its 4 MiB frame limit is below the existing 10 MiB Desktop attachment limit. Live voice continues on WebSocket; Relay sessions commit finalized visible events through `archive.append` rather than opening Archive storage.

The Kernel-controlled Archive router resolves a shared `RelayPrincipal` through the same credential verifier used by WebSocket authentication. In the current personal-Relay model, the Relay master credential and its paired-device credentials map to one Relay owner while retaining the calling Client/device identity for audit and Client Submission deduplication. Integration Plugin credentials are separate principals and require explicit Archive Access Grants expressed as Capability Grants. A future account system can change principal resolution without changing Archive records.

Network operations are coarse-grained and retryable:

- batch Client submissions with stable Client Submission identities;
- snapshot/incremental sync pages with Archive Cursors;
- staged attachment existence checks, uploads, and message association;
- content-free catalog queries and scoped reads/searches;
- migration batches and provider import pages with record-level results;
- owner-only deletion and grant management.

### 5. Make the change feed and Archive Cursor the only projection checkpoint

`archive_changes` is an append-only, globally ordered feed of visible upserts, revisions, attachment availability changes, and tombstones. An Archive Cursor is a versioned, integrity-protected token containing the Archive owner, feed epoch, last fully applied sequence, and snapshot high-water mark. Clients treat the token as opaque. A cursor conveys position only; Relay re-evaluates current authentication and scope on every request.

An empty projection first receives a consistent paged snapshot bounded by a high-water sequence, then continues from that sequence through incremental changes. Relay returns the next cursor only for a complete page. A Client persists it only after applying the entire page in one local transaction. If compaction changes the feed epoch or the cursor falls below the retained low-water mark, Relay returns `projection-reset-required`; the Client discards only projection tables and performs a new authorized snapshot.

A timestamp cursor and a message-ID cursor are rejected because concurrent sources, revisions, and deletions do not share either ordering. An indefinitely retained feed is also rejected; bounded feed retention is allowed because Client Projections are disposable and can reset.

### 6. Keep projection data physically separate from drafts, outbox, and legacy sources

Desktop and Mobile add dedicated projection tables keyed by Relay IDs, an Archive sync-state table, and separate draft/outbox tables keyed by stable local submission IDs. The existing `conversations`, `messages`, `message_attachments`, and Mobile summary tables remain read-only migration sources until migration is reconciled. New UI reads move to projection repositories after cutover.

This separation makes projection reset a table-scoped operation that cannot delete drafts, rejected submissions, or migration evidence. It is preferred over adding an `authoritative` flag to every legacy row because mixed tables make reset, retry, and foreign-key behavior fragile.

A Client Submission Identity is the pair of a stable Client installation identity and a randomly generated submission ID. Relay stores the accepted result under a uniqueness constraint and returns that result for retries. Outbox rows move to accepted only after the authoritative transaction succeeds; rejection retains the user's local text and an actionable reason without inserting it into projection history.

### 7. Migrate a frozen legacy inventory with typed source identities

Each Client establishes and persists a Source Installation ID before inspecting source rows. Migration then records a stable inventory watermark, switches new composition to the outbox/Relay path, and submits legacy conversations, messages, and attachments in dependency order. Every source record uses `(sourceSystem, sourceInstallationId, sourceRecordType, sourceRecordId)`; Relay enforces this tuple as unique.

Migration has durable Client states for inventory, transfer, reconciliation, and completion, plus per-record accepted, unavailable, or failed results. A restart reuses the same Source Installation ID and source identities. Completion requires every inventoried record to be reconciled; failures remain visible and retryable rather than rolling back accepted records.

Only still-existing user-visible conversation text, titles needed for presentation, timestamps, supported attachment metadata, and readable attachment payloads are migrated. Client summaries, latency fields, tracing data, VAPI/runtime continuation fields, raw audio, and local settings are not Archive content. Missing pre-cutover rows remain unknown; neither ID gaps nor similar text create tombstones or merges.

### 8. Stage and verify attachments before linking them

Attachment originals are addressed by SHA-256 digest plus byte length. A Client first asks whether a verified blob already exists; otherwise it streams bytes to a temporary object. Relay validates the declared supported MIME type and size, recomputes digest and length, then atomically promotes the object. The message association and source attachment record are committed only against a verified blob.

When a legacy file reference is unreadable, the migration submits its typed Source Record Identity and metadata with `unavailable` state and no invented bytes. Byte-identical attachments share one original while retaining separate message associations and provenance. Clients generate and evict thumbnails locally; thumbnails are not authoritative blobs.

Blob reference counts are treated as derived bookkeeping. Deletion enqueues a durable mark-and-sweep check; the collector removes an original only when no live Archive association references it. This avoids losing a shared blob after a stale counter or partially completed retry.

### 9. Normalize only committed user-visible semantics at the ingestion boundary

Archive commands accept typed normalized fields, not arbitrary Provider envelopes. The producer of an event classifies the channel before submission: finalized user input and user-visible Semantic Output are eligible; private thinking, hidden prompts, tool traces, presentation-only deltas, raw audio, synthesized audio, and Provider payloads have no Archive fields and are rejected if submitted as excluded content.

Classification is based on the contract channel and user visibility, not text heuristics. A visible sentence explaining a decision is ordinary assistant text. Private Chain of Thought remains private even if it contains a polished sentence. Streaming deltas are assembled into the committed user-visible representation instead of becoming one Archive event per token or speech chunk. Execution-time summaries built from prior visible text remain derived context and are not inserted as conversation messages.

### 10. Treat Harness History Import as a separate source coordinator

An Integration Plugin discovers content-free import sources, obtains the required grant, and opens an import session bound to Provider, Workspace, Harness Thread, plugin/profile version, and mode. Automatic/resumable mode requires stable Thread, event, revision, and provider cursor identities. A Provider without them receives a warned one-shot import session whose generated identity deduplicates retries only within that explicit attempt; it cannot schedule background synchronization.

Relay validates and commits valid source events independently, reports per-record failures, and advances the durable provider cursor only through the highest contiguous resolved source range. An explicit `voiceclawConversationId` may associate events with an existing conversation only after Provider and Workspace context validation; otherwise the stable Thread becomes a distinct External Conversation.

Deleting an External Conversation writes Import Suppression keyed by its Provider/Workspace/Thread identity in the same logical-deletion transaction. Automatic import checks suppression before accepting content. A later manual import requires an explicit owner action that removes or overrides suppression; retrying an old request cannot do so.

### 11. Make logical deletion transactional and physical purge asynchronous

The acknowledgment transaction marks the conversation/events deleted, removes readable text and attachment associations from the current read model and full-text index, appends tombstones to the change feed, creates Import Suppression when applicable, and enqueues unreferenced-blob checks. All reads and searches filter on live state inside the Archive repository, so stale application caches cannot re-expose content after commit.

After commit, workers purge superseded live payload copies, unused attachment blobs, expired upload staging files, and rebuildable index/cache material. Tombstones, content-free suppression keys, source identities required for retry safety, and content-free audit facts remain according to their separate retention policy. Failed cleanup is retried without reverting logical deletion.

Hard-deleting all rows synchronously is rejected because it cannot both acknowledge promptly and protect shared attachments or offline projections. Retaining deleted readable payload behind a flag is also rejected because a query bug could expose it.

### 12. Keep Catalog, grants, search, and audit metadata-first

The Archive Catalog is computed only from source kind, Provider, Workspace, time coverage, content types, and synchronization status. It never returns titles, message snippets, attachment names, prompts, or payload hashes. Catalog access does not imply content access.

Archive Access Grants bind a plugin principal to named source/Workspace scopes and operations such as `archive.read`, `archive.search`, attachment read, or `archive.read.all`. Revocation is checked on every request rather than cached for a connection lifetime. Full-text search uses a rebuildable Relay-side index of live normalized text, always joins through the current grant scope, and removes indexed content in the logical-deletion transaction. Audit rows record principal, grant, operation, scope, result, counts, and time without copying query results or conversation content.

Memory read or production permissions never satisfy an Archive permission check. A future Memory Entry stores Memory Evidence references to stable Archive records, not copied transcripts.

### 13. Keep Decision Context in Agent Memory, not in the conversation record

If a user or assistant states a decision and rationale visibly, the original text is archived normally. A future Memory Producer may derive a structured Decision Context containing a Decision, Decision Rationale, and Decision Evidence References. That derived, editable object belongs to Agent Memory and references the original Archive events, attachments, ADRs, proposals, research, or normalized Outcome Evidence.

Archive may retain a content-free audit fact that a Memory object referenced an event, but it does not store the authoritative Decision Context payload. This preserves the distinction between what was actually said and a later mutable interpretation while avoiding duplicate source content.

### 14. Fix the review comparison point and isolate implementation work

The planning-time Git point is `c9e8ca15d55cd9b2a58189333ef7d2d2273776a2`. The worktree already contains changes from earlier work, so Archive implementation must begin in an isolated worktree/branch from an agreed clean baseline or first land the unrelated changes. Before the first implementation task, `tasks.md` must record the actual clean baseline commit used for the final code review; implementation must not silently absorb the current unrelated dirty delta.

No prototype was used for this design.

## Risks / Trade-offs

- [A single SQLite writer can become a throughput limit] → Keep commands batched, transactions short, WAL enabled, and storage ports replaceable; collect metrics before introducing a multi-node store.
- [A Relay SQLite driver may fail in the Node 20 Docker or Desktop-staged bundle path] → Verify the selected driver in both packaging paths before schema implementation; replace only the storage adapter if the driver is unsuitable.
- [A corrupt or copied Relay data directory can expose history] → Require filesystem permissions, TLS for remote access, opaque credentials, and document encrypted-volume deployment; application-level encryption can be added behind the blob/store ports.
- [Cursor compaction forces a large Client rebuild] → Make reset explicit, preserve drafts/outbox, page snapshots, and expose last-sync/reset diagnostics.
- [Attachment staging can consume disk without accepted events] → Enforce size/type limits before transfer and garbage-collect expired unlinked staging objects.
- [Partial migration may leave users unsure which history is authoritative] → Freeze a source inventory, expose per-record state, and switch each Client UI only after reconciliation rather than silently mixing stores.
- [Provider revision histories increase storage] → Keep complete content only for the current revision by default and retain content-free supersession metadata; an explicit retention policy is required to preserve older payloads.
- [Grant mistakes could disclose more Archive content than intended] → Default deny, separate Catalog from content, require explicit `archive.read.all`, re-check grants per request, and test scope joins at the repository boundary.
- [Classification mistakes could archive private reasoning] → Accept only typed visible-semantic fields, never raw Provider events, and place Provider-specific translation inside Integration Plugins.
- [Logical deletion and asynchronous purge can be misunderstood as immediate byte erasure] → Report logical unavailability separately from purge progress and document the limits of operational backups.

## Migration Plan

1. After the Kernel change is reviewed, package the official Archive Feature Plugin with its Manifest and Relay Archive Authority/Storage Contribution. Add the plugin-namespaced metadata/blob stores, schema migrations, repository contracts, and ArchiveService while leaving existing Client history unchanged.
2. Register authenticated Archive Capability Contracts and their `/v1/archive` transport projection, then add live-pipeline final-event commits, attachment staging, change feed, grants, search, deletion, and purge workers. Shadow-write only in development until behavior tests pass; never treat shadow data as user authority.
3. Add Desktop and Mobile projection/outbox schemas and Source Installation IDs. Inventory legacy rows without modifying them, then exercise idempotent migration against a disposable Relay.
4. Enable one Client at a time to migrate, reconcile, build a full projection, and switch its history UI to Relay authority. Keep legacy tables read-only for rollback during a bounded release window.
5. Enable provider-neutral Harness History Import after grants, suppression, revisions, and partial-success behavior are verified.
6. After both Clients have stable projection sync, remove legacy local writes and the current ad hoc transcript-to-Brain cleanup path. Do not replace that path with Agent Memory until `establish-relay-agent-memory` is implemented.
7. Rollback before Client cutover by disabling Archive writes and continuing to use untouched legacy tables. After cutover, roll back application binaries without rolling back the Archive schema or sequence; a compatible build must continue syncing or export accepted Relay events back into a recovery projection. Never make legacy local history authoritative again after Relay-accepted writes exist.

## Open Questions

- Exact general Plugin Manifest fields, Capability Grant granularity, third-party Relay isolation, uninstall data disposition, and cross-device contribution upgrade behavior are owned by `establish-voiceclaw-feature-plugin-kernel`; this design must consume the confirmed contract rather than settle them locally.

- Initial projection cache budgets can vary by Desktop and Mobile and may be tuned without changing the authority or reset protocol.
- Change-feed retention duration and attachment garbage-collection grace periods remain deploy-time tuning values; cursors and deletion behavior do not depend on particular durations.
- Backup retention and verified purge procedures belong to deployment/operations documentation, provided backups never participate in live reads or projection restoration after their retention expires.

## Why

Desktop and Mobile currently treat separate local databases as conversation-history authorities, so history cannot be synchronized or recovered consistently across Clients and later Harness imports have no safe identity or deletion model. VoiceClaw needs one Relay-resident Conversation Archive authority before durable cross-device history, Agent Memory provenance, and Harness History Import can ship. The default implementation is an official Archive Feature Plugin, not an irreplaceable database subsystem hard-coded into VoiceClaw Kernel; a non-persistent real-Harness prototype does not wait for it.

## What Changes

- Deliver the official Archive Feature Plugin whose Relay Archive Authority/Storage Contribution is the sole cross-Client authority for VoiceClaw conversation history across every Conversation Pipeline. Desktop and Mobile retain disposable Client Projections for display and read-only offline access rather than independent writable histories.
- Expose Archive behavior through versioned Capability Contracts including `archive.append`, `archive.read`, `archive.search`, `archive.import`, and `archive.evidence.resolve`. Kernel-enforced Capability Grants and controlled RPC mediate every cross-plugin access; no plugin receives direct Archive database access.
- Add authenticated Archive APIs and ordered projection synchronization. A Client Projection contains only rebuildable Relay-derived data; a disconnected Client may read that cache and keep drafts or outbox entries alongside it, but an authoritative conversation event exists only after Relay accepts it.
- Perform a one-time, restart-safe import of still-existing Desktop and Mobile records. Identify every imported record by source system, Source Installation ID, source record type, and source record ID; never heuristically merge records across installations or infer deleted history from numeric ID gaps.
- Preserve structured Conversation Origin and immutable source-event identity. Relay records explicit tombstones for deletions after cutover, while imported records that were already absent before migration remain unknown rather than receiving fabricated tombstones.
- Store normalized conversation text once and import existing Desktop Message Attachments. Content-address and deduplicate original images, treat thumbnails as evictable projections, and preserve an “attachment unavailable” record when a referenced local file is missing.
- Keep raw microphone audio, synthesized speech, private reasoning, summaries derived solely from private reasoning, full Provider wire payloads, and tracing content outside the Archive by default. A user-visible rationale remains ordinary Semantic Output and may be archived as assistant text; tracing remains an independent metadata-first system and cannot restore Archive content.
- Provide a content-free Archive Catalog and controlled Archive access. Content access is scoped, revocable, and audited; full-archive access requires an explicit `archive.read.all` grant, and raw Archive search remains separate from Agent Memory access.
- Define provider-neutral Harness History Import using stable provider, workspace, thread, event, and revision identities; durable cursors; partial-success reporting; and idempotent retry. Import is one-way and never edits or deletes the Provider-owned Harness Thread.
- Keep an imported Harness Thread as a distinct External Conversation unless an explicit VoiceClaw Conversation mapping exists. Providers without stable identities support warned one-shot manual import only and cannot enable automatic synchronization.
- When a user deletes an External Conversation, create Import Suppression so subsequent synchronization cannot silently recreate it. Deletion immediately removes content from authorized reads, then permits asynchronous payload purge, attachment reference cleanup, and content-addressed garbage collection while retaining only the minimum content-free suppression and tombstone state.
- Keep Conversation Archive and Agent Memory separate. Archive records may become Memory Evidence only through separately authorized Memory Inclusion defined by the successor Agent Memory change; this change does not produce, retrieve, or inject Agent Memory.
- Keep non-persistent realtime Conversation usable when no Archive Feature Plugin is installed, while making cross-device history, search, import, Client Projection, and Archive Evidence dependencies explicitly unavailable rather than silently promoting a Client cache or tracing store to authority.

## Capabilities

### New Capabilities

- `conversation/archive`: Feature-provided, Relay-authoritative conversation events, structured origin, attachments, catalog, scoped access, deletion, tombstones, suppression, retention, and storage-minimizing content rules.
- `conversation/client-projection`: Disposable Desktop/Mobile projections, online authoritative writes, offline read/draft/outbox behavior, synchronization, and one-time migration from existing local histories.
- `harness-history/import`: Provider-neutral, one-way Harness Thread discovery and import with stable source identities, cursors, revisions, partial success, idempotent retry, External Conversations, and Import Suppression.

### Modified Capabilities

- None. Existing voice and Harness execution requirements continue to produce conversation events; this change introduces their shared persistence and synchronization authority without changing Pipeline semantics.

## Impact

- Depends on `establish-voiceclaw-feature-plugin-kernel` for Plugin Manifest validation, Contribution lifecycle, Capability Contracts and Grants, controlled RPC, data namespaces, audit, version negotiation, migration coordination, and non-bypassable deletion/ownership rules. Archive implementation tasks SHALL NOT be finalized until that contract is reviewed.
- Affects the official Archive Plugin Package, its Relay, import, projection, and Client UI Contributions, Relay persistence and Archive APIs, plus Desktop and Mobile local database schemas, migration, projection caches, drafts/outboxes, history UI, attachment transfer, and synchronization tests.
- Requires a stable Source Installation ID and typed Source Record Identity before local import, plus a recoverable migration checkpoint so restarts cannot duplicate records or silently skip failures.
- Moves future authoritative history writes to Relay without deleting the existing local databases; after cutover they serve as migration sources and bounded Client Projections.
- Adds content-addressed attachment ownership and garbage collection inside the Archive Feature Plugin's Kernel-managed Relay data namespace. Existing missing local files remain represented but are not reconstructed or guessed.
- Supplies the Archive and provenance contracts consumed by `establish-relay-agent-memory`, Harness History Import, and later persistent routing/provider features without introducing Host, execution, Provider, or Memory behavior here. The prototype Host and Routing changes detect `archive.append` as an optional Capability and do not depend on this change.
- Preserves Relay's independent deployment boundary: Clients use authenticated network contracts and cannot assume Relay shares a process, filesystem, or database with Desktop or Mobile.

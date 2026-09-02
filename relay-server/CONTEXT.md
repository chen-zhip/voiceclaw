# Relay

The Relay context is VoiceClaw's authenticated conversation orchestration boundary. It connects clients to voice and agent capabilities without owning the client user experience.

## Language

### Agent execution

**Brain Agent**:
The task-level delegate used by the operator path. It answers an `ask_brain` request but does not own the surrounding voice conversation.
_Avoid_: Harness, realtime voice provider

**Harness**:
The primary agent executor for a Harness-backed conversation turn and the owner of work performed in its bound workspace.
_Avoid_: Desktop Host, Brain Agent

### Extension model

**Harness Plugin**:
A Harness-native extension that supplies agent behavior such as a skill, command, tool, or workflow.
_Avoid_: VoiceClaw Core feature

**VoiceClaw Integration Plugin**:
A trusted local VoiceClaw extension that carries provider-specific protocol, version, Capability Profile, configuration, and translation knowledge without reimplementing agent behavior.
_Avoid_: Harness Plugin, duplicated provider implementation

### Session concepts

**Relay Session**:
The authenticated conversation-control lifetime associated with one client connection.
_Avoid_: Local Conversation, provider thread

**Conversation Turn Queue**:
The Relay-owned serial order of user inputs for one conversation, with at most one active executor turn.
_Avoid_: Parallel merge, client-local queue

**Logical Provider Binding**:
The Relay-owned, cross-client identity of a provider, workspace, active Desktop Host, Integration Plugin, and non-sensitive preferences.
_Avoid_: Native Provider Configuration, local executable path

**Conversation Thread Mapping**:
The persistent association from a VoiceClaw conversation, provider, and workspace to one Harness Thread. A change of provider or workspace creates a distinct mapping.
_Avoid_: Per-turn thread, cross-workspace thread reuse

**Conversation Archive**:
Relay's authoritative, cross-client record of conversations known to VoiceClaw, including conversations imported from a Harness Provider.
_Avoid_: Client cache, Harness Thread, Agent Memory

**Harness Thread**:
A provider-owned working conversation used by a Harness to continue agent execution. It may be imported into the Conversation Archive without becoming the archive itself.
_Avoid_: Conversation Archive, Relay Session

**Harness History Import**:
The one-way ingestion of provider-owned Harness Threads into the Conversation Archive. Import never edits or deletes the source Harness Thread.
_Avoid_: Bidirectional sync, provider-thread migration

**External Conversation**:
A Conversation Archive entry imported from a Harness Thread and classified by its provider, workspace, and stable thread identity. It remains separate unless an explicit VoiceClaw conversation mapping exists.
_Avoid_: Heuristically merged conversation, Harness Thread

**Conversation Origin**:
The structured provenance of an archived conversation event, distinguishing VoiceClaw input from a named external provider and thread.
_Avoid_: `isVoiceClaw` boolean, inferred source

**Archive Access Grant**:
A revocable, per-plugin authorization to read a declared portion of the Conversation Archive. Full-archive access is an explicit grant and still uses the controlled Archive API.
_Avoid_: Direct database access, global plugin trust

**Archive Catalog**:
The content-free inventory of providers, workspaces, time coverage, content types, and synchronization status available in the Conversation Archive.
_Avoid_: Conversation content, database schema inspection

**Derived Archive Record**:
A namespaced, versioned record produced by a plugin from archived content without modifying the original conversation events.
_Avoid_: Edited transcript, source event

**Import Suppression**:
A Relay-owned record that prevents a user-deleted External Conversation from being automatically re-imported from the same source identity.
_Avoid_: Harness deletion, temporary sync failure

**Agent Memory**:
Durable facts, preferences, and knowledge derived for future agent work, normally maintained by the active executor or a Harness Plugin.
_Avoid_: Conversation Archive, raw transcript

### Authority boundaries

**Task Side Effect**:
A user-task change to files, processes, external systems, or durable agent state. The active executor owns the side effects it produces.
_Avoid_: Workspace Binding, presentation update

**Intent Confirmation**:
VoiceClaw's confirmation that the interpreted request matches what the user intends to do.
_Avoid_: Provider-native Approval, tool permission

**Provider-native Approval**:
An execution provider's decision about whether a particular tool or permission class may be used. Intent Confirmation never grants it implicitly.
_Avoid_: Intent Confirmation, VoiceClaw permission

**Approval Route**:
The path that presents a Provider-native Approval through Relay to an active paired Client while leaving enforcement and timeout semantics with the Harness Provider.
_Avoid_: Relay approval, automatic approval

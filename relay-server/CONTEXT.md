# Relay

The Relay context is VoiceClaw's authenticated conversation orchestration boundary. It connects clients to voice and agent capabilities without owning the client user experience.

## Language

### Conversation paths

**Conversation Pipeline**:
The selected path that turns user input into assistant output for one Relay Session.
_Avoid_: Voice mode, agent backend

**S2S Direct**:
An S2S pipeline in which the realtime voice model invokes Relay-provided tools directly.
_Avoid_: Harness mode, operator mode

**S2S Operator**:
An S2S pipeline in which the realtime voice model delegates a task to a Brain Agent through `ask_brain`.
_Avoid_: Harness mode, direct mode

**STT/TTS Harness**:
A composed pipeline in which finalized recognized text is handled by a Harness and its speech output is synthesized separately.
_Avoid_: Brain call, S2S mode

### Agent execution

**Brain Agent**:
The task-level delegate used by S2S Operator. It answers an `ask_brain` request but does not own the surrounding voice conversation.
_Avoid_: Harness, realtime voice provider

**Harness**:
The primary agent executor for an STT/TTS Harness conversation turn and the owner of work performed in its bound workspace.
_Avoid_: Harness Adapter as a synonym for the executor, Brain Agent, Desktop Host

**Harness Integration Contract**:
The provider-neutral messages and states exchanged between Relay and a Desktop-hosted VoiceClaw Integration Plugin.
_Avoid_: Harness Adapter in domain prose, Harness-native protocol, provider runtime, Relay-side provider implementation

**Harness Execution Capability Contract**:
The versioned provider-neutral runtime contract `harness.execution@1`, with the operations `provider.describe`, `thread.ensure`, `turn.start`, and `turn.cancel`. It is transported through a Kernel Invocation Envelope and never exposes Provider-native method or event names.
_Avoid_: Provider-native protocol, Relay Adapter, Capability Profile

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
The persistent, Relay-owned control-plane association from a VoiceClaw conversation, provider, and workspace to one Harness Thread. It stores identity mapping but no message content. A change of provider or workspace creates a distinct mapping; an unavailable Provider or Host makes it dormant rather than deleting it.
_Avoid_: Per-turn thread, cross-workspace thread reuse

**Relay Control State**:
The durable, content-free coordination state required for Relay authority, including grants, Host registration and revocation, Active Host Assignment generations, and Conversation Thread Mappings. It never contains conversation messages, attachments, Semantic Output, Memory content, or evidence payloads.
_Avoid_: Conversation Archive, Agent Memory, transcript store, plugin data namespace

**Conversation Archive**:
The authoritative, cross-client record of conversations known to VoiceClaw, supplied by the active Archive Feature Plugin's Relay Archive Authority Contribution and including conversations imported from a Harness Provider.
_Avoid_: Client cache, Harness Thread, Agent Memory

**Archive Cursor**:
A Relay-issued opaque checkpoint identifying the last ordered Archive change fully applied by a Client Projection.
_Avoid_: Message ID, timestamp, local database offset

**Source Installation ID**:
The stable identity of one local conversation-database lineage used as a migration source.
_Avoid_: User ID, paired-device credential, telemetry identity

**Source Record Identity**:
The migration identity composed of source system, Source Installation ID, source record type, and source record ID.
_Avoid_: Bare local integer ID, content fingerprint

**Client Submission Identity**:
The stable identity assigned by a Client to one proposed Archive event so an uncertain submission can be retried without duplication.
_Avoid_: Archive event ID, message timestamp

**Harness Thread**:
A provider-owned working conversation used by a Harness to continue agent execution. It may be imported into the Conversation Archive without becoming the archive itself.
_Avoid_: Conversation Archive, Relay Session

**Harness Execution Attempt**:
One explicit dispatch of a VoiceClaw Conversation Turn to a Harness through the selected Logical Provider Binding and Active Host Assignment generation. Retrying preserved input creates a new Attempt rather than reopening the prior execution.
_Avoid_: Conversation Turn, Harness Thread, automatic retry

**Harness Terminal Outcome**:
The single normalized terminal classification of one Harness Execution Attempt: completed, failed, cancelled, or Outcome Unknown.
_Avoid_: Stream completion, Provider Availability, presentation status

**Outcome Unknown**:
A Harness Terminal Outcome used when execution may have been accepted or produced side effects but VoiceClaw cannot verify completion. It is never treated as safe evidence for automatic replay.
_Avoid_: Timeout as proof of failure, retryable failure

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
A revocable Capability Grant authorizing a Principal to read a declared portion of the Conversation Archive. Full-archive access is explicit and still uses the controlled Archive Capability Contract.
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
The Relay-authoritative collection of durable, scoped, user-governed information supplied by an active Memory Feature Plugin and available to future agent work, either user-authored or derived by a Desktop-hosted Memory Producer from authorized Memory Evidence.
_Avoid_: Conversation Archive, raw transcript, executor-owned memory store

**Memory Entry**:
A stable, Relay-owned unit of Agent Memory with a current readable revision, Memory Scope, provenance, and independent management lifecycle.
_Avoid_: Memory Candidate, embedding vector, copied transcript

**Memory Scope**:
The visibility and authorization boundary of Agent Memory, either User-global or limited to one Workspace.
_Avoid_: Conversation Archive partition, Producer location

**Memory Evidence**:
The authorized Conversation Archive records that establish the provenance of a Memory Candidate or Memory Entry.
_Avoid_: Copied transcript, raw Provider payload

**Outcome Evidence**:
A bounded, Provider-neutral record of observable execution facts, such as operation, target, status, test results, changed resources, and source references, that can support Memory Production without copying raw execution logs.
_Avoid_: Raw tool log, Provider wire payload, private reasoning, Decision Rationale

**Memory Inclusion**:
Authorization for Conversation content to become Memory Evidence and enter Memory Production. Inclusion does not guarantee that a Memory Candidate will be produced or accepted.
_Avoid_: Direct Memory write

**Memory Candidate**:
A proposed new Agent Memory or revision that has not yet passed Relay validation and applicable confirmation policy.
_Avoid_: Memory Entry, automatic global memory

**Memory Producer**:
The Desktop Host Contribution that derives Memory Candidates from authorized Memory Evidence through an Active Memory Host.
_Avoid_: Relay memory store, active agent executor

**Memory Producer Binding**:
The Relay-owned association between one Memory Scope and its selected Memory Producer. It excludes the execution Host and machine-specific configuration.
_Avoid_: Memory Producer Selection, Active Memory Host Assignment

**Active Memory Host Assignment**:
The Relay-owned selection of the Desktop Host authorized to execute Memory Production. It is independent of Harness Active Host Assignment.
_Avoid_: Memory Producer Binding, automatic host failover

**Memory Production Request**:
A durable request to derive Memory Candidates from a bounded set of Memory Evidence.
_Avoid_: Background Job, Conversation Turn

**Memory Production Pending**:
The accepted-but-not-started state of a Memory Production Request. Its pending reason identifies the current cause, such as an unavailable Active Memory Host.
_Avoid_: Awaiting Host as the state name, unqualified Pending in domain prose

**Memory Production Attempt**:
One Active Memory Host's execution attempt for a Memory Production Request.
_Avoid_: Memory Production Request, automatic retry

**Memory Suppression**:
A content-free Relay record that prevents a deleted Memory Entry or the same Memory Evidence lineage from being accepted again.
_Avoid_: Conversation Archive deletion, retained Memory content

**Decision Context**:
A structured Agent Memory view that presents a Decision, its Decision Rationale, and Decision Evidence References together while preserving their distinct semantics and lifecycle.
_Avoid_: Conversation Archive event, undifferentiated decision text, private reasoning

**Decision Rationale**:
A concise, public, and editable explanation of why a Decision was made, including its goal, constraints, decisive trade-offs, and principal rejected alternatives. It may be user-authored or explicitly marked as inferred from visible authorized inputs and evidence.
_Avoid_: Private Chain of Thought, raw evidence, unmarked model inference

**Decision Evidence**:
The verifiable facts and authorized sources that support or challenge a Decision Rationale. Outcome Evidence may supply such facts, while Memory Evidence establishes the containing Memory Entry's provenance.
_Avoid_: Decision Rationale, copied raw logs, unsupported model judgment

**Decision Evidence Reference**:
A typed pointer from Decision Context to one Decision Evidence source, resolved only when the requesting principal has permission to read that source.
_Avoid_: Embedded source payload, automatic Archive access grant

**Structured Output**:
An executor-side classification of output into non-exportable private reasoning and exportable public speech, screen text, Presentation State, and bounded Outcome Evidence. Provider Integrations remove the private class before Host RPC; Relay receives only allowed public classes.
_Avoid_: Transcript, raw provider event, a transport that carries private Chain of Thought

**Semantic Output**:
The task result and meaning authored by the active agent executor. VoiceClaw may validate and present it but does not silently change its conclusions.
_Avoid_: Presentation state, client event

**Presentation State**:
VoiceClaw-authored interaction information such as progress, routing, synthesis, and display state that does not alter Semantic Output.
_Avoid_: Task result, agent conclusion

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

**Explicit Fallback**:
A user-visible choice to retry or change the active pipeline or provider without silently transferring work to another executor.
_Avoid_: Automatic executor failover, implicit Direct fallback

**Recovery Guidance**:
Actionable instructions for resubmitting input or explicitly selecting another Conversation Pipeline when no executable recovery contract exists.
_Avoid_: Automatic retry, resumable recovery protocol

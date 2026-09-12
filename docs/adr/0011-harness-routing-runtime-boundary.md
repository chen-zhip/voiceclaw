# ADR-0011: Harness Routing Runtime Boundary

## Status

Accepted

## Context

The STT/TTS prototype originally composed STT, a legacy Harness adapter, and TTS
inside `ComposedAdapter`. That path could produce useful local output, but it did
not provide the control-plane guarantees required by provider-neutral Harness
routing: persistent content-free Thread Mapping, Active Host generation fencing,
explicit Attempt identity, or normalized public stream validation.

## Decision

Finalized STT text in production enters `HarnessExecutionDispatcher` through an
explicit Relay Session dependency. The dispatcher owns Turn/Attempt setup and
invokes `harness.execution@1.0.0` through the Relay Kernel. A selected Active Host
assignment supplies the generation and contribution identity. Host stream events
must pass `HarnessStreamRouter` before Client, TTS, Archive, or Memory projection.

`createProductionHarnessRouting` adapts the dispatcher into the port the session
layer consumes: it refuses any binding that does not match the Active Host
Assignment, takes the generation from that assignment, and supplies the
`harness.execution` contribution identity from Relay configuration so a client
can never redirect an invocation to another installed provider.

`HarnessAttemptSession` owns the Relay half of an attempt. It feeds the event
stream returned by `turn.start` through `HarnessStreamRouter`, synthesizes public
speech through `HarnessSpeechDelivery`, projects public screen output to the
Client, and completes exactly one terminal Attempt outcome. A stream that ends
without a terminal event settles as `outcome-unknown` rather than being replayed.

The Desktop realtime client carries the explicit STT/TTS mode and binding
selection in `session.config` and routes microphone data and playback through the
provider-neutral audio bridge. The `stt-tts-harness` Voice Mode option in Settings
is the user-reachable entry; an incomplete Provider/Workspace/binding selection
reports a visible error and the call does not start. Legacy `ComposedAdapter`
behavior remains only as a compatibility fallback when no routing port and binding
are supplied; it is not the completion path for the Harness routing change.

Dispatcher setup is transactional. Mapping or `turn.start` failure removes the
unaccepted Attempt and restores the Turn to the visible backlog. Dormant mappings
are not dispatchable until the selected Provider and Host binding is ready.

Only one Attempt is active per Conversation. A finalized input arriving while an
Attempt is active joins the visible serial backlog instead of failing the session.
Cancellation invokes `turn.cancel`, settles the Attempt as cancelled, and stops
waiting on in-flight synthesis while preserving audio already emitted.

## Consequences

Routing tests can use deterministic `harness.execution@1` fixtures without claiming
real Provider acceptance. Real Provider and physical microphone acceptance remain
owned by the downstream Codex integration change. The explicit dependency makes
production wiring visible and testable, while preserving S2S and older STT/TTS
clients that do not provide a Harness binding.

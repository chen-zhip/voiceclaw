# Desktop

The Desktop context is the native VoiceClaw experience and the local control plane for a user's installation.

## Language

**Desktop App**:
The VoiceClaw client installed on the user's computer, including its native user experience and local control plane.
_Avoid_: Main program, desktop client only

**Desktop Host**:
The part of the Desktop App that supervises local VoiceClaw services, hosts trusted Integration Plugins, and owns native operating-system integration.
_Avoid_: Relay, Harness

**Harness Provider**:
An agent execution service that supplies Harness behavior. A local Harness Provider is supervised by the Desktop Host but retains ownership of its agent execution semantics.
_Avoid_: Harness Adapter, Desktop Host

**Workspace Binding**:
The association between a Harness session and the user-selected project workspace in which it is allowed to operate. Desktop establishes the association; the Harness owns the resulting workspace work.
_Avoid_: Workspace work, conversation history

**Provider Availability**:
The operational status of a Harness Provider across integration registration, runtime detection, process and transport health, session readiness, and degradation.
_Avoid_: Capability Profile, adapter-present boolean, assumed availability

**Capability Profile**:
A versioned, hard-coded declaration in an Integration Plugin of the VoiceClaw behaviors attributed to a Harness Provider. An unverified Harness version uses the nearest profile with a visible warning.
_Avoid_: Runtime probe, Provider Availability, Relay capability switch

**Active Host Assignment**:
The user-selected Desktop Host that may serve one Provider and Workspace Binding at a time.
_Avoid_: Automatic host failover, shared active host

**Native Provider Configuration**:
Machine-specific Harness paths, executable locations, and secret references owned by a Desktop Host.
_Avoid_: Logical binding, Relay credential store

**Bundled Relay**:
An independently functioning Relay distributed and supervised by the Desktop App for local personal use.
_Avoid_: Desktop-owned conversation engine, embedded-only Relay

**Native TUI Handoff**:
An explicit transfer of an idle Harness Thread's active control from VoiceClaw to a Provider-native terminal on the Active Desktop Host.
_Avoid_: Concurrent controller, Desktop Client bypass, automatic takeover

**Paired Device**:
A mobile device authorized to use a Desktop-hosted Relay.
_Avoid_: Remote user, anonymous client

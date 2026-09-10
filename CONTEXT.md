# VoiceClaw System

VoiceClaw is a Harness-neutral, multi-device framework that composes trusted runtime boundaries with installable product capabilities.

## Language

**VoiceClaw Kernel**:
The minimum trusted substrate that validates and coordinates plugins and enforces identity, authorization, isolation, ownership, deletion, audit, version, migration, and fencing invariants across Relay, Desktop Host, and Clients. It is a logical responsibility spanning runtimes, not a fourth deployment process.
_Avoid_: VoiceClaw Core as a synonym, Feature Plugin, DeepSeek Harness runtime

**VoiceClaw Plugin Package**:
The top-level distributable unit containing a Plugin Manifest, one Feature Plugin definition, its Contributions, Capability Contract declarations, configuration schema, permissions, compatibility information, lifecycle metadata, migrations, and disable/uninstall policy.
_Avoid_: A single process module, Harness Plugin package, unscoped plugin

**Plugin Manifest**:
The Kernel-validated declaration of a VoiceClaw Plugin Package's identity, version, compatibility, Feature Plugin, Contributions, contracts, configuration, permissions, lifecycle, migrations, and data disposition policy.
_Avoid_: Runtime configuration as a whole, Capability Profile

**Feature Plugin**:
The logical VoiceClaw product capability that users and developers install, enable, configure, upgrade, and manage. A Feature Plugin composes one or more runtime-specific Contributions and is not a shared base class or a single-process object.
_Avoid_: Harness Plugin, VoiceClaw Integration Plugin, Contribution, VoiceClaw Kernel

**Contribution**:
One implementation module of a Feature Plugin deployed to a declared runtime and category. Supported categories include `relay-service`, `desktop-service`, `client-ui`, `provider-integration`, `harness-extension`, `background-worker`, and `command/tool`.
_Avoid_: Feature Plugin, arbitrary cross-runtime code loading

**Contribution State**:
The independently reported lifecycle or availability state of one Contribution: `PENDING`, `LOADING`, `ACTIVE`, `DEGRADED`, `FAILED`, or `DISPOSED`. One unavailable runtime does not by itself make every Contribution in the Feature Plugin failed.
`ACTIVE` means the implementation is loaded and its declared contract can be invoked; Provider process, transport, and Session readiness remain separate operational state and may move the Provider Contribution to `DEGRADED`.
_Avoid_: Feature Plugin enabled state, Provider Session readiness, Provider Availability

**Capability Contract**:
A versioned, implementation-neutral interface through which a Contribution provides or consumes a named VoiceClaw capability across a Kernel-enforced authorization boundary. Cross-Harness contracts are Provider-neutral; Provider-specific contracts remain confined to their integration boundary.
_Avoid_: Capability Profile, direct database access, shared-process trust

**Capability Grant**:
A revocable and audited authorization from the Kernel allowing a Principal to invoke one declared operation of a Capability Contract within a Scope. Secret and Workspace access may be narrowed further to declared references or bindings. A Manifest permission request is not a grant.
_Avoid_: Service dependency, plugin installation, Provider-native Approval

**Kernel Invocation Envelope**:
The Provider-neutral, Kernel-controlled wrapper for one Capability invocation, carrying contract and version, operation, invocation identity, Principal, selected Contribution, authority generation, Scope, and trace correlation. A domain payload supplies its own business identities and data.
_Avoid_: Provider-native wire event, Harness execution payload, permission grant

**Model Inference Capability**:
A Capability Contract through which an authorized Feature Plugin may request new model inference and receive public, structured output. It does not expose an existing executor's private Chain of Thought.
_Avoid_: Private reasoning access, Provider credential access, transcript fallback

**Harness Plugin**:
A Harness-native Skill, Tool, Command, Workflow, Prompt, or similar extension that can be installed and run without VoiceClaw. VoiceClaw may describe, install, connect, or manage it through a `harness-extension` Contribution.
_Avoid_: VoiceClaw Contribution, VoiceClaw Integration Plugin, Feature Plugin

**VoiceClaw Integration Plugin**:
The established name for a Provider-specific VoiceClaw integration implemented as a `provider-integration` Contribution. It owns protocol, version, static Capability Profile, native event translation, configuration and credential references, history import adaptation, and limited Provider presentation metadata, but not cross-Provider product semantics.
_Avoid_: Harness Plugin, Feature Plugin, Memory implementation, Archive authority

**VoiceClaw Profile**:
A named, inspectable composition of enabled VoiceClaw Plugin Packages, selected Capability providers, configuration overlays, and runtime placements used to produce a VoiceClaw deployment or product experience.
_Avoid_: Capability Profile, opaque bundle patch

**UI Slot**:
A versioned Client extension point through which an authorized `client-ui` Contribution adds bounded presentation or interaction without importing or replacing the Client shell.
_Avoid_: Arbitrary page injection, direct cross-package component import

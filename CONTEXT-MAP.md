# VoiceClaw Context Map

VoiceClaw is a Harness-neutral, multi-context Agent interaction and capability-hosting framework. Its trusted Kernel spans the Desktop, Mobile, and Relay contexts; installable Feature Plugins contribute product behavior without becoming an additional authority boundary. The remaining workspaces support distribution, documentation, and observability.

System-wide plugin and framework terminology is defined in [VoiceClaw System](./CONTEXT.md). Workspace-specific terms remain in the context documents below.

## Contexts

- [Desktop](./desktop/CONTEXT.md): native user experience and local control plane
- [Mobile](./mobile/CONTEXT.md): paired mobile user experience and audio endpoint
- [Relay](./relay-server/CONTEXT.md): authenticated conversation and provider orchestration
- [Website](./website/CONTEXT.md): distribution and optional account support
- [Documentation](./docs/CONTEXT.md): public product and engineering guidance
- [Tracing Collector](./tracing-collector/CONTEXT.md): local telemetry ingestion and persistence
- [Tracing UI](./tracing-ui/CONTEXT.md): local telemetry exploration

## Relationships

- **Desktop → Relay**: Desktop may bundle and supervise a local Relay as a deployment convenience; Relay remains an independently deployable service with its own authority.
- **Desktop → Harness Provider**: Desktop supervises a local Harness Provider through a VoiceClaw Integration Plugin and binds its sessions to user-selected workspaces; the Harness owns work performed inside them.
- **Mobile → Relay**: Mobile uses an authenticated Relay as its control plane, including when media takes an optimized direct-to-provider path.
- **Relay → Agent execution**: Relay supports three explicit execution paths: S2S Direct, S2S Operator, and STT/TTS Harness.
- **Relay ↔ Desktop**: Relay owns logical provider and workspace bindings; Desktop owns machine-specific paths, processes, and secret references.
- **Harness Provider → Relay**: Harness-specific integration plugins may import provider conversations into Relay's Conversation Archive on demand or through configured background synchronization.
- **VoiceClaw Kernel → Plugin Packages**: the Kernel validates manifests, coordinates runtime Contributions, mediates Capability Contracts, and enforces grants, isolation, ownership, deletion, audit, migration, and fencing invariants.
- **Feature Plugin → Runtime contexts**: one Feature Plugin may contribute Relay services, Desktop services, Client UI, workers, tools, Provider integrations, or Harness extensions while each Contribution retains independent runtime state.
- **VoiceClaw → Harness ecosystems**: Harness-native behavior belongs in Harness Plugins first; a `harness-extension` Contribution may manage those external plugins, while a `provider-integration` Contribution supplies the existing VoiceClaw Integration Plugin boundary.
- **Archive/Memory → Kernel**: the default distribution installs official Archive and Memory Feature Plugins; their implementations are replaceable, but they can access data and other capabilities only through Kernel-enforced contracts and grants.
- **Routing → Archive/Memory**: STT/TTS Harness routing treats Archive and Memory as optional Capability providers rather than activation dependencies; without them, live Relay-Session conversation still works, and an unavailable or failed optional call is reported as an explicit degraded feature result without falling back to Client, Tracing, Brain storage, or another Provider.
- **Relay → Tracing Collector**: Relay may export metadata-first telemetry; collection and presentation remain supporting concerns and never become conversation storage.
- **Website → Desktop/Mobile**: Website supports distribution and optional account flows but is not required for a core conversation.

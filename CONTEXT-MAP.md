# VoiceClaw Context Map

VoiceClaw is a multi-context product. The VoiceClaw Core consists of the Desktop, Mobile, and Relay contexts; the remaining workspaces support distribution, documentation, and observability.

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
- **VoiceClaw Core → Extensions**: Agent capabilities belong in Harness Plugins first; VoiceClaw Integration Plugins expose only the cross-boundary integration needed by the Core.
- **Relay → Tracing Collector**: Relay may export metadata-first telemetry; collection and presentation remain supporting concerns and never become conversation storage.
- **Website → Desktop/Mobile**: Website supports distribution and optional account flows but is not required for a core conversation.

## Why

Harnesses already support planning through provider-native skills, commands, tools, and workflows, but VoiceClaw cannot consistently discover a configured planning workflow, let a user select it, or present its lifecycle across clients. The integration must expose those Harness capabilities without creating a second planning system in VoiceClaw Kernel or another Feature Plugin.

## What Changes

- Define planning behavior as optional external Harness Plugins. Each Harness-native plugin owns its planning prompts, commands, tools, workflow state, semantic result, and project-native configuration and can run without VoiceClaw.
- Deliver the VoiceClaw-side planning experience as a Feature Plugin with `harness-extension` and `client-ui` Contributions. It describes, installs, connects, or manages supported Harness Plugins through Harness-native mechanisms and consumes Provider Integration Capability Contracts without copying Provider protocol implementations.
- Add a thin planning bridge through each relevant VoiceClaw Integration Plugin's `provider-integration` Contribution. The bridge owns only Provider command translation, invocation envelope validation, lifecycle-event translation, and presentation metadata; it does not implement planning behavior.
- Declare support for the planning bridge in the Integration Plugin's versioned static Capability Profile. Report whether a configured Harness Plugin is installed and enabled as runtime inventory/Provider Availability without dynamically changing the profile.
- Let Relay store only the logical planning-plugin selection and non-sensitive preferences. Harness or its plugin owns project/workspace configuration; Desktop Host owns machine-specific paths and opaque native references.
- Treat an explicit user selection or confirmed request as invocation intent, not as a third authorization system. Intent Confirmation remains VoiceClaw-owned, and all tool permissions remain Provider-native Approval enforced by the Harness.
- Preserve Harness-authored Semantic Output. Integration Plugin and Relay may validate envelopes, normalize lifecycle/presentation events, route detailed text and speech, and show Provider-specific metadata without changing the planning conclusion.
- Provide initial Claude Code and Codex Harness Plugin examples plus their thin Integration Plugin bridges and validation fixtures. Additional planning workflows are added through the Harness's native plugin mechanism, not by extending a VoiceClaw `tool/` behavior registry.
- If a planning Harness Plugin needs conversation history, require the `archive.read` or `archive.search` Capability Contract and an explicit scoped Capability Grant; package or Harness Plugin installation never implies conversation-content access.
- Keep unconfigured or disabled planning plugins out of interpretation, confirmation, and execution. Failure preserves the request and offers explicit retry or normal Harness execution; it never silently changes executor or planning workflow.
- Trace metadata only by default. Planning content and Provider-specific details require explicit diagnostic opt-in and redaction.

## Capabilities

### New Capabilities

- `harness-plugin/planning-workflow`: Optional provider-native planning skills, commands, tools, or workflows with Harness-owned configuration, semantics, approvals, and side effects.
- `voice/planning-selection`: Cross-client discovery and selection of configured planning Harness Plugins through a thin Integration Plugin bridge, including logical preferences, lifecycle presentation, diagnostics, and explicit fallback.

### Modified Capabilities

None. This change consumes the Integration Plugin, static Capability Profile, Archive grant, session routing, and Provider-native Approval contracts from `complete-harness-provider-integrations` without changing them.

## Impact

- Deferred until after the prototype critical path. Depends on Kernel Phase 0 plus the later plugin/Provider contracts required by its selected Harnesses; `archive.read` or `archive.search` remains an optional separately granted Capability rather than a prerequisite for planning without history access.
- May be invoked after `add-voice-confirmation` confirms the user's interpreted request, but Relay does not automatically choose a planning workflow or perform semantic classification.
- Affects Provider-native Harness Plugin packages/examples, corresponding Integration Plugin bridges, Relay logical selection, Desktop/Mobile configuration and lifecycle presentation, metadata-first tracing, documentation, and validation fixtures.
- Removes the planned VoiceClaw `tool/` behavior extension surface, central planning adapter registry, Core-owned Provider implementations, and Core-owned global/project workflow configuration.
- Introduces no required planning dependency and does not change S2S or STT/TTS Harness behavior when no planning Harness Plugin is selected.

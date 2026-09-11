## Why

VoiceClaw's STT/TTS Harness pipeline has a tested Relay-side scaffold and reserved Provider IDs, while `integrate-codex-provider-prototype` now owns the first runnable real-Harness vertical slice. After that prototype proves the Kernel, Desktop Host, Routing, and Integration Plugin seams, this change converges additional Providers and advanced parity without moving provider-specific decisions into Relay or Client code.

## What Changes

- Deliver VoiceClaw Plugin Packages for `claude-code`, `codex`, `openai-compatible`, and `cherry-studio`. Each package presents one Provider-integration Feature Plugin and contains a `provider-integration` Contribution plus optional `harness-extension` and settings `client-ui` Contributions. Preserve the existing `claude-code`, `codex`, and `cherry-studio` provider IDs; `openai-compatible` is a new stable provider ID. Exact package IDs remain a later design decision.
- Preserve “VoiceClaw Integration Plugin” as the domain name for each Provider-specific `provider-integration` Contribution; do not generalize it to Archive, Memory, or unrelated Feature Plugins.
- Add `claude-code` through the Claude Agent SDK and extend the prototype `codex` package from its proven Phase 0 profile toward the shared multi-Provider contract. Each plugin owns its Provider protocol, version recognition, normalized event translation, supported Harness Thread/history translation, and native lifecycle knowledge.
- Implement `openai-compatible` against `POST /v1/chat/completions` with SSE streaming and a fixed minimal Capability Profile. Features that this protocol does not reliably define—such as Provider-native history, Approval, native TUI handoff, rollback, and resumable recovery—remain explicitly unsupported rather than inferred from endpoint behavior. Responses API support is outside this change.
- Implement `cherry-studio` as a concrete Integration Plugin under its reserved stable ID. Any future rename requires a separate compatibility migration.
- Give every plugin versioned, hard-coded Capability Profiles. A verified Harness version selects its exact profile; an unverified version uses the nearest known profile with a persistent warning. Runtime initialization, model/tool inventories, and health checks update Provider Availability without adding, removing, or redefining profile capabilities.
- Keep executable paths, Provider credentials, secret references, and other machine-specific configuration on the Desktop Host. Relay, Clients, and the Conversation Archive receive only provider-neutral state and opaque references allowed by the predecessor Host contract.
- Populate Desktop and Mobile Harness selection surfaces from Kernel-managed Contribution discovery and normalized profile metadata. Diagnostics and unsupported operations remain visible without Client branches on Provider names.
- Prohibit Provider-name branching in VoiceClaw Kernel, generic Harness routing, and Client capability decisions; provider-specific branches live inside their `provider-integration` Contributions. Existing S2S Direct Provider Adapters are outside this restriction and remain unchanged.
- Preserve the existing `harness` wire/config field and legacy Harness Integration Contract entry points as a compatibility facade while internal execution moves to Desktop-hosted Integration Plugins. Removing the legacy surface requires a later explicit breaking change.
- On external Harness Thread import, show an unchecked “将此次导入内容加入 Memory” control. Enabling it grants Memory Inclusion only for that import; disabling it still imports the Conversation into the Archive and does not change Workspace defaults.

## Capabilities

### New Capabilities

- `harness-provider/concrete-integrations`: Production Claude Code, Codex, OpenAI-compatible Chat Completions, and Cherry Studio Provider Plugin Packages and Integration Plugin Contributions; their stable identities, protocol mappings, static Capability Profiles, availability reporting, supported history translation, and registry-driven Client entries.

### Modified Capabilities

- `harness-adapter/interface`: Preserve the legacy interface as a compatibility facade while concrete execution is supplied by Desktop-hosted Integration Plugins through the provider-neutral Harness Integration Contract.
- `voice/stt-tts-mode`: Allow STT/TTS Harness conversations to select and use registered concrete Harness Providers while preserving explicit unsupported-operation and fallback behavior.

## Impact

- Follows `integrate-codex-provider-prototype` and depends on the established Kernel, Desktop Host, and Harness Execution Routing contracts. Archive, Memory, Harness History Import, full Approval Route, and Native TUI Handoff are optional successor capabilities whose provider-specific portions are added only when their owning changes are ready; they are not prerequisites for the first real-Harness path.
- Affects Provider Plugin Package manifests, Desktop-hosted `provider-integration` Contributions and registration, optional Harness extensions/settings UI, Desktop native Provider discovery/configuration, Relay compatibility adapters, Desktop/Mobile Harness selection and import controls, Provider fixtures, and cross-boundary integration tests.
- Adds Claude Agent SDK and Codex app-server integration dependencies behind their Desktop-hosted plugins. OpenAI-compatible endpoints use Desktop-owned base URL and authentication configuration; Provider credentials never move to Relay.
- Keeps current wire fields and reserved IDs compatible. `openai-compatible` is a new ID and requires no alias migration; unrelated OpenAI-compatible Brain Agent and S2S paths retain their current meanings.
- Keeps S2S as the default stable Conversation Pipeline. This change adds no Provider-specific branches to S2S Direct and does not turn tracing or imported history into Agent Memory automatically.
- Keeps DeepSeek Harness outside this change's concrete Provider set. It remains a future peer Harness Provider and architecture reference, never a prerequisite or Kernel runtime.

## Why

The Desktop Host contract already requires the Host to load enabled `provider-integration` Contributions through Kernel Phase 0, but the shipped wiring passes an empty contribution list, so no Provider package is ever active outside tests. The bundled local Relay also receives a fixed environment allow-list that omits the voice-provider and Harness-plugin settings the new GPT-SoVITS and Codex packages read. The result is that `yarn dev:desktop` starts Relay, Host, and Client, yet no Harness Provider can serve a Conversation Turn.

## What Changes

- Give the Desktop Host a real Contribution loader: discover local `voiceclaw.plugin.json` packages from configured plugin roots, validate them with the shared Manifest v0 rules, load each `provider-integration` entry, and register it with normalized readiness.
- Supply the pieces a Provider package needs at load time: the Active Host identity, the binding's Native Provider Configuration, and a Provider process boundary that the package's entry can use in production rather than only in tests.
- Extend the bundled Relay environment allow-list so the Relay receives the voice-provider settings (`GPT_SOVITS_*`) and the Harness package selection (`VOICECLAW_SHIPPED_PLUGIN_ROOTS`, `VOICECLAW_HARNESS_PACKAGE_ID`, `VOICECLAW_HARNESS_CONTRIBUTION_ID`) the desktop side already reads.
- Give the Codex package a production process boundary and entry contract so the Host can load it without a test-only boundary.
- Out of scope: supporting an externally started Relay before the Desktop Host (today `startBundledRelayServer` returns early without establishing a local Host bootstrap, so that combination cannot register); Host credential rotation; third-party signing or isolation; anything that changes Provider-visible behavior in the existing specs.

## Capabilities

### New Capabilities

None. Every behavior below is already required by `desktop-host/harness-contract` (Provider Contribution loading and readiness; local Harness Provider lifecycle) and by `voice/stt-tts-mode` (provider selection and configuration). This change closes implementation gaps rather than changing specified behavior, so it opts out of specs.

### Modified Capabilities

None.

## Impact

- `desktop/src/main/desktop-host/*` and `desktop/src/main/ipc-handlers.ts`: real Contribution discovery, loading, and registration instead of an empty list.
- `desktop/src/main/services/relay-server.ts`: forwarded environment for voice and Harness-plugin settings.
- `desktop/src/main/providers/codex/*`: a production process boundary plus the entry contract the loader expects.
- No Kernel, Routing, `@voiceclaw/contracts`, or Client contract changes; the Relay still revalidates only a secret-free Manifest projection.

## Why

The STT/TTS Harness route is not a runnable Harness prototype until a real Provider processes microphone-derived input. Codex app-server is the first vertical slice because its explicit Thread, Turn, streamed Item, interruption, and terminal protocol exercises Host, Routing, and fencing contracts rather than substituting an ordinary Chat Completions endpoint.

## What Changes

- Deliver one first-party `voiceclaw.plugin.json` manifest v0 package containing one Codex Feature Plugin, one `provider-integration` Contribution, and the minimum Desktop settings/selection `client-ui` Contribution.
- Implement only the `@voiceclaw/contracts` definitions of Manifest v0, Kernel Invocation Envelope, Host readiness, and `harness.execution@1`; the Codex package neither requires nor imports Archive or Memory implementations.
- Establish installed `codex-cli 0.153.4` as the only exactly verified prototype Capability Profile. During implementation, generate an immutable app-server JSON Schema artifact, record generator version `0.153.4`, and store a SHA-256 fingerprint; other versions may use the nearest profile only with a persistent unverified warning.
- Validate Native Provider Configuration and expose Contribution, executable, process, transport, and Provider Session readiness separately.
- Maintain one owned Codex app-server process per Active Host plus Native Provider Configuration and reuse it across sequential mapped Threads; a different configuration uses a different process.
- Map `harness.execution@1` operations to Codex stdio JSON-RPC initialization, Thread creation/resume, Turn dispatch, streamed notification translation, interruption, and terminal outcomes.
- Exclude raw reasoning before Host RPC. Only public Semantic Output, Presentation State, bounded Provider-neutral Outcome Evidence, usage, terminal outcomes, and content-free redacted diagnostics cross the Contribution boundary.
- Keep all Codex version/method/event/profile branches inside the Codex Integration Plugin.
- Provide deterministic fixture tests, an opt-in real installed/authenticated app-server system test, and a physical Desktop microphone-to-playback acceptance journey. The real acceptance Profile excludes Archive and Memory packages; only the latter two tests can satisfy real-Harness acceptance.
- Defer History Import, Native TUI Handoff, complete Approval Route, advanced recovery, and all non-Codex Providers.

## Capabilities

### New Capabilities

- `harness-provider/codex-prototype`: Codex package/profile, app-server lifecycle and version/schema handling, `harness.execution@1` implementation, Thread/Turn mapping, public stream translation, cancellation, normalized outcomes, Desktop configuration/selection, and real-Harness acceptance.

### Modified Capabilities

None.

## Impact

- Strictly depends on `establish-voiceclaw-feature-plugin-kernel`, then `establish-desktop-harness-host-contract`, then `establish-harness-execution-routing`; no upstream change depends on Codex acceptance.
- Archive and Memory remain optional downstream Feature Plugins and are neither build-time nor runtime prerequisites for Codex execution.
- Implementation will use the already installed Codex CLI/app-server but this planning revision installs or runs no Provider dependency.
- `complete-harness-provider-integrations` remains the later multi-Provider convergence change.

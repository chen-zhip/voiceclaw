## Why

The STT/TTS Harness path currently exposes failures but not enough stage-by-stage evidence to locate silence endpointing, recognition, Harness handoff, synthesis, or audio-delivery stalls. Explicit debug output is needed now so the in-progress local GPT-SoVITS and Desktop-hosted Harness integration can be diagnosed without adding ad hoc logging during every investigation.

## What Changes

- Add explicitly enabled, server-side debug output for the STT/TTS Harness pipeline, covering component selection and connection, audio receipt and commit/endpoint decisions, STT invocation and final transcript, Harness dispatch and public speech delivery, TTS invocation and emitted audio statistics, completion, cancellation, and failure.
- Correlate debug lines with the session and turn where those identifiers exist, and identify the pipeline stage and selected provider without changing Client wire events.
- Include complete finalized STT transcript text and complete text submitted to TTS, as explicitly approved for this diagnostic mode.
- Keep debug output disabled by default and exclude microphone/audio payloads, synthesized audio/base64, credentials, tokens, bootstrap secrets, and raw/private Provider reasoning from every debug line.
- Preserve existing errors, routing, provider selection, timing requirements, and S2S behavior; logging failures must not interrupt a session.

## Capabilities

### New Capabilities

- `voice/stt-tts-debug-output`: opt-in, correlated, content-aware diagnostic output for the STT/TTS Harness pipeline, including its safety and non-interference requirements.

### Modified Capabilities

None. The existing `voice/stt-tts-mode` behavior and wire contract remain unchanged; this change adds an operator-facing diagnostic capability around that pipeline.

## Impact

- `relay-server/src/log.ts` and Relay startup/configuration: debug enablement and a testable diagnostic sink.
- `relay-server/src/session.ts`, STT/TTS provider integration, Harness stream routing, and TTS delivery: stage-level diagnostic emission and correlation.
- `relay-server/test/**`: deterministic assertions through existing provider/session public seams and an injected or captured diagnostic sink.
- Desktop service logs receive the Relay process output through the existing service log stream; no new Client event, dependency, or persistent user-data format is introduced.

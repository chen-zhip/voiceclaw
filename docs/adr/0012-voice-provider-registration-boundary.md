# ADR-0012: Voice Provider Registration Boundary

## Status

Accepted

## Context

Harness Providers already reach VoiceClaw as first-party Feature Plugin packages
(`provider-integration` Contributions hosted by Desktop). Relay's STT and TTS
providers do not: they are in-process implementations selected by id through
`createSTTProvider` / `createTTSProvider` and declared per session as
`sttProvider` / `ttsProvider`. Phase 0 accepts only `desktop-service`,
`provider-integration`, and `client-ui` Contributions, so a Relay-hosted voice
provider currently has no package form.

Adding local, self-hosted voice capability from one GPT-SoVITS installation made
this boundary explicit: synthesis runs as an HTTP request per speech unit, while
recognition runs as an offline ASR invocation per utterance. They share an
installation and a configuration baseline, but not a transport, a readiness
state, or a failure mode.

## Decision

Relay voice providers stay factory-registered, first-party, in-process
implementations of the existing `STTProvider` / `TTSProvider` boundaries until
`complete-harness-provider-integrations` defines a Relay voice-provider
Contribution type. They are identified **once per boundary**: a local
installation contributes one synthesis id and one recognition id, and neither id
answers the other boundary. GPT-SoVITS therefore registers `gpt-sovits-tts` and
`gpt-sovits-stt` as separate providers that may share configuration resolution
and a capability-baseline record, but never a component identity, lifecycle, or
readiness state.

Session selection remains per boundary, so a local provider may be paired with
any other registered provider on the other boundary, and a failure or version
mismatch degrades exactly the boundary it belongs to.

## Consequences

Voice providers will move again when a Relay voice-provider Contribution type
exists; migration is a packaging change over these boundaries, not a redesign.
Until then, provider ids, capability baselines, and readiness are documented per
boundary, and nothing in Kernel, Routing, Desktop Host, or Client branches on a
voice provider name.

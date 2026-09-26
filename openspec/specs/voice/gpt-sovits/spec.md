# voice/gpt-sovits Specification

## Purpose

Supplies local, self-hosted voice support for both halves of the STT/TTS Harness loop from one GPT-SoVITS installation: a separately implemented and selected synthesis provider over its local HTTP API, and a separately implemented and selected recognition provider through its bundled offline ASR.

## Requirements

### Requirement: Separate local providers per voice boundary

The system SHALL expose two separately registered voice providers backed by the local GPT-SoVITS installation: one synthesis provider under the id `gpt-sovits-tts` that satisfies only the TTS provider boundary, and one recognition provider under the id `gpt-sovits-stt` that satisfies only the STT provider boundary. The system SHALL let a session select each id independently through the existing provider configuration without branching on provider names in generic routing.

#### Scenario: Session selects both local providers

- **WHEN** a client sends `session.config` with `ttsProvider: "gpt-sovits-tts"` and `sttProvider: "gpt-sovits-stt"` and valid component configuration
- **THEN** relay constructs the synthesis provider for the TTS boundary and the recognition provider for the STT boundary, each reported under its own id

#### Scenario: Only one boundary is served locally

- **WHEN** a client selects `gpt-sovits-tts` for synthesis and a different registered provider for recognition
- **THEN** each configured provider serves only its own boundary and neither is substituted for the other

#### Scenario: A provider id is used for the wrong boundary

- **WHEN** a session selects `gpt-sovits-stt` as its synthesis provider or `gpt-sovits-tts` as its recognition provider
- **THEN** relay reports that the configured provider is not available for that boundary and does not substitute the other local provider

### Requirement: Local reference-conditioned speech synthesis

The system SHALL synthesize public Harness speech through the configured local GPT-SoVITS service using the session's reference audio and language, and SHALL stream the returned audio to the client as decoded PCM16 chunks.

#### Scenario: Speech is synthesized locally

- **WHEN** relay submits a complete speech unit to the `gpt-sovits-tts` provider
- **THEN** the provider requests synthesis from the local service with the configured reference audio, language, and synthesis parameters, and emits client-playable PCM16 audio chunks

#### Scenario: Synthesis fails

- **WHEN** the local service is reachable but rejects a synthesis request or returns undecodable audio
- **THEN** relay reports an actionable synthesis failure and does not silently select another TTS provider

### Requirement: Synthesis configuration and readiness

The system SHALL require the local service address, reference audio, and target language before reporting the `gpt-sovits-tts` provider ready, and SHALL report actionable guidance when any required setting or the local runtime is unavailable.

#### Scenario: Required synthesis setting is missing

- **WHEN** a session selects `gpt-sovits-tts` for synthesis without a service address or reference audio
- **THEN** the provider reports an actionable configuration error at connect time and no synthesis is attempted

#### Scenario: Local service is not running

- **WHEN** the configured synthesis service cannot be reached
- **THEN** the provider reports an actionable availability error, synthesis is not attempted, and the session does not fall back to another voice provider

### Requirement: Utterance speech recognition through bundled offline ASR

The system SHALL, through the `gpt-sovits-stt` provider, recognize each finalized utterance of streamed PCM16 input by invoking the GPT-SoVITS offline ASR runtime, and SHALL emit exactly one final transcript per utterance.

#### Scenario: Utterance is recognized

- **WHEN** the client streams PCM16 speech followed by an end-of-utterance condition
- **THEN** the provider submits that utterance to the offline ASR runtime, emits its recognized text as the final transcript, and dispatches no second transcript for the same utterance

#### Scenario: Client commits the audio buffer

- **WHEN** the client signals end of its audio buffer while an utterance is still pending
- **THEN** the provider finalizes that utterance, emits its final transcript, and reports no further transcripts

#### Scenario: Interim recognition is unavailable

- **WHEN** the selected provider recognizes speech through the offline ASR path
- **THEN** the system emits no interim hypothesis for that provider and never presents partial text as a final transcript

### Requirement: Recognition configuration and runtime availability

The system SHALL require the local GPT-SoVITS installation path, the runtime that executes its ASR, and the recognition language before reporting the `gpt-sovits-stt` provider ready, and SHALL report actionable guidance when any of them is unavailable.

#### Scenario: Recognition runtime is missing

- **WHEN** the configured GPT-SoVITS installation path or the runtime that executes its ASR cannot be resolved
- **THEN** the provider reports an actionable availability error at connect time, emits no transcript, and does not silently select another STT provider

#### Scenario: Recognition fails for one utterance

- **WHEN** the offline ASR invocation fails, times out, or returns no usable text for an utterance
- **THEN** the provider reports that failure and emits no transcript for that utterance while remaining available for later utterances

### Requirement: Capability baseline compatibility

The system SHALL treat the recorded GPT-SoVITS capability baseline — the synthesis request fields, the offline ASR invocation arguments, and the required local assets it depends on — as the only verified interface, and SHALL fail closed rather than guess when the configured installation does not match it.

#### Scenario: Configured installation matches the baseline

- **WHEN** the configured installation exposes the recorded synthesis request shape and offline ASR arguments
- **THEN** the provider reports the matched baseline and serves synthesis and recognition

#### Scenario: Configured installation does not match the baseline

- **WHEN** the configured installation lacks a recorded synthesis capability, ASR argument, or required local asset
- **THEN** the provider fails closed with a persistent, visible mismatch warning and does not invent capability support at runtime

### Requirement: Local runtime boundary

The system SHALL reference the GPT-SoVITS installation only through configuration and runtime invocation, and SHALL NOT import it as a build dependency or include the local checkout in the repository's version-controlled sources.

#### Scenario: Repository stays free of the local installation

- **WHEN** the change is complete
- **THEN** the local GPT-SoVITS checkout is excluded from version control, no product workspace imports it at build time, and its location is supplied by configuration

### Requirement: Observable playback position

The system SHALL report only the synthesis progress the `gpt-sovits-tts` provider can actually observe, and SHALL NOT claim audible playback timing it cannot measure.

#### Scenario: Provider reports playback progress

- **WHEN** relay tracks playback position for the `gpt-sovits-tts` provider
- **THEN** the reported position reflects only submitted synthesis progress and no measured acoustic timing

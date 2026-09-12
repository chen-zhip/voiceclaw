# Voice STT/TTS Mode Specification

## Purpose

Defines how Relay selects the S2S Direct, S2S Operator, or STT/TTS Harness Conversation Pipeline from session configuration, and how the STT/TTS Harness Pipeline routes finalized speech through a Desktop-hosted Harness execution back to Desktop playback.

## Requirements

### Requirement: Conversation Pipeline selection

The system SHALL resolve session configuration to an explicit Conversation Pipeline while preserving existing wire fields, and Desktop SHALL expose an explicit STT/TTS Harness entry after a valid Provider and Workspace are selected.

#### Scenario: User configures STT/TTS mode

- **WHEN** Desktop sends `session.config` with `mode: "stt-tts"` and a valid Provider/Workspace selection
- **THEN** Relay selects the STT/TTS Harness Conversation Pipeline regardless of `voiceMode`

#### Scenario: Relay support does not imply a Client entry point

- **WHEN** Relay accepts `mode: "stt-tts"` after this change
- **THEN** the prototype requires the Desktop entry point while the Client-neutral contract still does not assert that Mobile exposes one

#### Scenario: Mobile support is deferred

- **WHEN** the Desktop prototype is available
- **THEN** public session and routing contracts remain Client-neutral but do not claim a Mobile entry point

#### Scenario: Direct pipeline selection

- **WHEN** `mode` is omitted, invalid, or `"s2s"`, and `voiceMode` is omitted, invalid, or `"direct"`
- **THEN** Relay selects S2S Direct

#### Scenario: Operator pipeline selection

- **WHEN** `mode` is omitted, invalid, or `"s2s"`, and `voiceMode` is `"operator"`
- **THEN** Relay selects S2S Operator

#### Scenario: Supervisor scaffold compatibility

- **WHEN** `mode` is omitted, invalid, or `"s2s"`, and `voiceMode` is `"supervisor"`
- **THEN** Relay accepts the legacy scaffold value and executes S2S Direct

### Requirement: STT provider configuration

The system SHALL allow configuring STT provider and its parameters.

#### Scenario: Configure a registered STT boundary

- **WHEN** client sends `session.config` with a registered `sttProvider` and its required `sttConfig`
- **THEN** relay constructs that STT adapter through the provider boundary

#### Scenario: STT provider not available

- **WHEN** configured STT provider is not installed or API key is invalid
- **THEN** relay sends `error` event with actionable message (e.g., "Deepgram API key invalid")

### Requirement: TTS provider configuration

The system SHALL allow configuring TTS provider and its parameters.

#### Scenario: Configure a registered TTS boundary

- **WHEN** client sends `session.config` with a registered `ttsProvider` and its required `ttsConfig`
- **THEN** relay constructs that TTS adapter through the provider boundary

#### Scenario: Configure sentence batch size

- **WHEN** client sends `session.config` with `ttsConfig: { sentenceBatchSize: 3 }`
- **THEN** relay buffers 3 complete sentences before submitting to TTS; when omitted, default is 1 (synthesize per sentence)

#### Scenario: TTS failure degradation

- **WHEN** configured TTS provider fails during synthesis
- **THEN** relay reports the failure and continues text output without silently selecting another TTS Provider

### Requirement: Audio input processing

The system SHALL accept microphone audio from Desktop, route it through the selected STT Provider, display partial recognition, and dispatch only finalized recognized text through the selected Desktop-hosted `harness.execution@1` provider.

#### Scenario: Streaming STT recognition

- **WHEN** Desktop sends `audio.append` while STT/TTS Harness is selected
- **THEN** Relay forwards audio to STT, emits partial transcript updates, and does not dispatch them to Harness

#### Scenario: Final STT result

- **WHEN** Desktop commits microphone audio and STT emits final text
- **THEN** Relay creates the Harness Turn and invokes the selected Host binding

### Requirement: Harness integration

The system SHALL process only provider-neutral public output from the selected Desktop-hosted `harness.execution@1` provider. Routing acceptance MAY use a deterministic contract fixture; this SHALL NOT count as real-Harness acceptance.

#### Scenario: Send query to Harness

- **WHEN** STT produces final text and the selected binding is ready
- **THEN** Relay invokes `thread.ensure` and `turn.start` without branching on Provider name

#### Scenario: Stream Harness output

- **WHEN** the selected provider emits normalized stream events
- **THEN** Relay routes public speech/screen Semantic Output, Presentation State, bounded Outcome Evidence, usage, and terminal outcome according to their classifications

#### Scenario: Raw private reasoning is presented

- **WHEN** raw Provider reasoning reaches the Relay boundary
- **THEN** Relay rejects it and does not expose it to Client, TTS, Archive, Memory, or another plugin

#### Scenario: Scaffold adapter is configured for production

- **WHEN** the only production execution path is fake, no-op, empty-result, or Relay-side Chat Completions behavior
- **THEN** the system reports no real Harness Provider ready and the Codex prototype remains unaccepted

#### Scenario: Archive and Memory are not installed

- **WHEN** Desktop selects a ready STT/TTS Harness binding in the minimal prototype Profile
- **THEN** the Pipeline remains available and completes through the Host without requiring Archive or Memory implementation modules

### Requirement: Audio output synthesis

The system SHALL synthesize public Harness-authored speech through the selected TTS Provider, stream audio to Desktop, and expose observable playback state. Routing tests MAY use fixture-authored normalized output; real app-server and physical playback acceptance belong to `integrate-codex-provider-prototype`.

#### Scenario: Stream TTS audio

- **WHEN** Harness output contains a complete public speech unit
- **THEN** Relay calls TTS and emits synthesized audio events

#### Scenario: Sentence-level streaming

- **WHEN** speech content arrives across multiple deltas
- **THEN** Relay buffers and synthesizes each complete sentence as soon as its boundary is detected

#### Scenario: Sentence batching trade-off

- **WHEN** `sentenceBatchSize` is greater than 1
- **THEN** Relay batches that many complete sentences, accepting later first audio in exchange for more cross-sentence TTS context

#### Scenario: Sentence batching cap

- **WHEN** `sentenceBatchSize` exceeds 5
- **THEN** Relay clamps it to 5

#### Scenario: Trailing sentence flush

- **WHEN** output terminates with an incomplete trailing sentence
- **THEN** Relay flushes the remaining buffer to TTS

#### Scenario: CJK sentence boundaries

- **WHEN** accumulated speech contains `。`, `！`, or `？`
- **THEN** Relay treats them as sentence boundaries

#### Scenario: TTS queue backpressure

- **WHEN** multiple sentences await synthesis
- **THEN** Relay does not exceed the TTS Provider concurrency limit

#### Scenario: TTS playback tracking

- **WHEN** the TTS Provider reports playback progress
- **THEN** Relay tracks only the granularity the Provider supplies and does not claim finer timing

#### Scenario: Desktop playback observation

- **WHEN** Relay emits synthesized audio for allowed Semantic Output
- **THEN** Desktop begins playback and reports observable playback state

### Requirement: End-to-end latency

The system SHALL minimize latency in the STT/TTS Harness Conversation Pipeline.

#### Scenario: Fast path for simple queries

- **WHEN** user query is simple (e.g., "what time is it")
- **THEN** deterministic boundary testing shows Relay scheduling from recognized text to first synthesized chunk completes within 3 seconds, excluding external Provider latency

#### Scenario: Complex task with streaming

- **WHEN** Harness task takes >5 seconds
- **THEN** deterministic boundary testing shows Relay submits the first complete speech unit to TTS within 2 seconds of receiving it, excluding external Provider latency

### Requirement: Error handling and Recovery Guidance

The system SHALL report STT, TTS, Host, Provider, and Harness failures with actionable Recovery Guidance, preserve input when possible, and require an explicit user decision before a new Attempt or executor change.

#### Scenario: STT provider timeout

- **WHEN** the STT Provider does not respond within 10 seconds
- **THEN** Relay reports an STT error, preserves recoverable input, and does not silently switch STT Provider

#### Scenario: Harness unreachable

- **WHEN** the selected Host or Harness contract cannot be reached before execution begins
- **THEN** Relay preserves input and offers explicit new Attempt, Provider reselection, or return-to-S2S without automatic dispatch

#### Scenario: Outcome is unknown

- **WHEN** connectivity is lost after Provider execution may have begun
- **THEN** Relay marks the Attempt `outcome-unknown`, warns about possible side effects, and requires acknowledgment before a new Attempt

#### Scenario: Recovery remains advisory

- **WHEN** Relay reports Recovery Guidance
- **THEN** Relay does not automatically retry, switch Provider, switch Host, or switch Conversation Pipeline

### Requirement: Backward compatibility

The system SHALL preserve existing S2S wire configuration behavior while keeping STT/TTS components isolated to `mode: "stt-tts"`.

#### Scenario: S2S Direct session unaffected

- **WHEN** configuration resolves to the S2S Direct Conversation Pipeline
- **THEN** no STT/TTS Harness components are instantiated

#### Scenario: S2S Operator session unaffected

- **WHEN** configuration resolves to the S2S Operator Conversation Pipeline
- **THEN** no STT/TTS Harness components are instantiated

#### Scenario: Client version detection

- **WHEN** older client does not send `mode` field
- **THEN** relay resolves `voiceMode` using the existing S2S mapping, defaulting to S2S Direct when `voiceMode` is also omitted or invalid

# Voice STT/TTS Mode Specification

## Purpose

Defines how Relay selects the S2S Direct, S2S Operator, or STT/TTS Harness Conversation Pipeline from session configuration, and how the STT/TTS Harness scaffold composes STT, a Harness Integration Contract boundary, and TTS.

## Requirements

### Requirement: Conversation Pipeline selection

The system SHALL resolve session configuration to an explicit Conversation Pipeline while preserving the existing wire fields.

#### Scenario: User configures STT/TTS mode
- **WHEN** client sends `session.config` with `mode: "stt-tts"`
- **THEN** relay selects the STT/TTS Harness Conversation Pipeline regardless of `voiceMode`

#### Scenario: Relay support does not imply a Client entry point
- **WHEN** Relay accepts `mode: "stt-tts"`
- **THEN** this capability does not assert that Desktop or Mobile exposes production configuration or controls for the mode

#### Scenario: Direct pipeline selection
- **WHEN** `mode` is omitted, invalid, or `"s2s"`, and `voiceMode` is omitted, invalid, or `"direct"`
- **THEN** relay selects the S2S Direct Conversation Pipeline

#### Scenario: Operator pipeline selection
- **WHEN** `mode` is omitted, invalid, or `"s2s"`, and `voiceMode` is `"operator"`
- **THEN** relay selects the S2S Operator Conversation Pipeline

#### Scenario: Supervisor scaffold compatibility
- **WHEN** `mode` is omitted, invalid, or `"s2s"`, and `voiceMode` is `"supervisor"`
- **THEN** relay accepts the legacy scaffold value and executes the S2S Direct Conversation Pipeline

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

The system SHALL route client audio through STT provider to produce text.

#### Scenario: Streaming STT recognition
- **WHEN** client sends `audio.append` events while the STT/TTS Harness Conversation Pipeline is selected
- **THEN** relay forwards audio to STT provider and emits `transcript.delta` with partial results

#### Scenario: Final STT result
- **WHEN** client sends `audio.commit` event
- **THEN** STT provider emits final recognized text and relay sends it to Harness

### Requirement: Harness integration

The system SHALL send recognized text through the selected available Harness Integration Contract boundary and process structured output.

#### Scenario: Send query to Harness
- **WHEN** STT produces final text "find bugs in auth module"
- **THEN** relay submits that text through the selected Harness Integration Contract boundary

#### Scenario: Stream Harness output
- **WHEN** Harness streams structured output chunks
- **THEN** relay routes thinking/speech/text to appropriate handlers

### Requirement: Audio output synthesis

The system SHALL synthesize speech content through TTS provider.

#### Scenario: Stream TTS audio
- **WHEN** Harness outputs `speech: { content: "I found 3 bugs" }`
- **THEN** relay calls TTS provider and emits `audio.delta` events with synthesized audio

#### Scenario: Sentence-level streaming
- **WHEN** Harness streams speech content across multiple deltas
- **THEN** relay buffers deltas and synthesizes each complete sentence as soon as its boundary is detected

#### Scenario: Sentence batching trade-off
- **WHEN** `sentenceBatchSize` is set to n greater than 1
- **THEN** relay buffers n complete sentences before synthesis, so first-audio starts later but TTS receives cross-sentence context for more natural prosody

#### Scenario: Sentence batching cap
- **WHEN** `sentenceBatchSize` exceeds 5
- **THEN** relay clamps it to 5 to avoid unacceptable first-audio delay

#### Scenario: Trailing sentence flush
- **WHEN** Harness finishes output with an incomplete trailing sentence (no ending punctuation)
- **THEN** relay flushes the remaining buffer to TTS as a final sentence

#### Scenario: CJK sentence boundaries
- **WHEN** accumulated speech contains `。`, `！`, or `？`
- **THEN** relay treats them as sentence boundaries for Chinese speech

#### Scenario: TTS queue backpressure
- **WHEN** multiple sentences are pending synthesis
- **THEN** relay does not submit more sentences than the TTS provider can process concurrently

#### Scenario: TTS playback tracking
- **WHEN** TTS provider reports playback progress
- **THEN** relay tracks the reported character position for potential interruption without claiming finer playback timing than the Provider supplies

### Requirement: End-to-end latency

The system SHALL minimize latency in the STT/TTS Harness Conversation Pipeline.

#### Scenario: Fast path for simple queries
- **WHEN** user query is simple (e.g., "what time is it")
- **THEN** deterministic boundary testing shows Relay scheduling from recognized text to first synthesized chunk completes within 3 seconds, excluding external Provider latency

#### Scenario: Complex task with streaming
- **WHEN** Harness task takes >5 seconds
- **THEN** deterministic boundary testing shows Relay submits the first complete speech unit to TTS within 2 seconds of receiving it, excluding external Provider latency

### Requirement: Error handling and Recovery Guidance

The system SHALL report Provider or Harness failures with actionable Recovery Guidance without claiming or performing automatic recovery.

#### Scenario: STT provider timeout
- **WHEN** STT provider does not respond within 10 seconds
- **THEN** relay sends an error, preserves the audio buffer for explicit retry, and does not automatically switch STT Provider

#### Scenario: Harness unreachable
- **WHEN** the selected Harness Integration Contract boundary cannot be reached
- **THEN** relay sends an error that explains how to resubmit the input or configuration, or explicitly select S2S Direct or S2S Operator, without automatically replaying or transferring the turn

#### Scenario: Recovery remains advisory
- **WHEN** relay reports Recovery Guidance for a failed STT/TTS Harness turn
- **THEN** relay MUST NOT represent the guidance as an executable retry, automatically retry the request, or automatically switch Conversation Pipelines

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

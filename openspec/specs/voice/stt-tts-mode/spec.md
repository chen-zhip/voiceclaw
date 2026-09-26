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

### Requirement: Desktop STT/TTS assistant text output panel

Desktop SHALL render assistant output in the effective STT/TTS Harness view as full-width, left-aligned text sections without individual chat-bubble backgrounds or borders. Sections SHALL preserve text, line breaks, message identity, chronological order, and existing supported images and attachments. User messages and tool records SHALL retain their existing presentation and timeline positions.

#### Scenario: Read completed output

- **WHEN** a conversation containing multiple assistant replies is displayed in the STT/TTS Harness view
- **THEN** replies occupy the available transcript width with normal page padding, rather than the bubble width cap
- **AND** replies remain separated by spacing or subtle separators, without merging across user messages or tool records

#### Scenario: Read long text and attachments

- **WHEN** an assistant reply contains paragraphs, a long unbroken token, or supported images
- **THEN** text preserves paragraph breaks and wraps within the panel without horizontal page overflow
- **AND** existing supported images and attachment actions remain available

### Requirement: Desktop output panel streaming continuity

Desktop SHALL render partial assistant output and completed assistant output using the same panel presentation. Finalization SHALL replace the transient representation with one completed representation, without duplicate text or a forced scroll reset. Existing waiting indications SHALL appear inline without a separate assistant bubble.

#### Scenario: Partial output becomes a completed reply

- **WHEN** partial output builds from `你好` to `你好，世界` and the completed reply `你好，世界` arrives
- **THEN** the reader sees incremental output followed by exactly one completed `你好，世界` reply
- **AND** the streaming indicator disappears after completion

#### Scenario: Waiting for output

- **WHEN** the existing conversation state reports waiting for an assistant response and no assistant text is available
- **THEN** the waiting indication is displayed inline in the output area without an empty reply bubble

#### Scenario: Interruption or session end

- **WHEN** output is interrupted or a session ends
- **THEN** existing cancellation and transient-text cleanup semantics are preserved
- **AND** no stale streaming indicator remains and completed replies remain readable

### Requirement: Desktop output panel reading interactions

Desktop SHALL preserve selectable text, per-message copy and context-menu actions, optional timestamp and latency information, and the existing follow-latest scrolling behavior in the output panel.

#### Scenario: User reads earlier content

- **WHEN** the reader scrolls upward and further assistant output arrives
- **THEN** the viewport remains at the reader's position and the existing jump-to-latest control becomes available
- **AND** activating that control returns to the latest output and resumes following new output

#### Scenario: Reader follows output at the bottom

- **WHEN** the reader is at the bottom and an assistant reply grows
- **THEN** the viewport follows the latest visible text

#### Scenario: Copy an individual reply

- **WHEN** the user selects text or opens a completed reply's context menu
- **THEN** text remains selectable and the existing copy action copies that reply's content without neighboring replies
- **AND** enabled timestamp and latency information remains associated with that reply

### Requirement: Desktop output panel mode isolation

Desktop SHALL select the presentation using the effective voice mode. Connecting and active sessions SHALL retain their startup mode, including reconnects. When idle, Desktop SHALL use the selected voice mode and refresh it on returning to the chat page. Existing history SHALL use the current presentation mode without inferring or persisting a historical mode per message. This presentation change SHALL preserve existing microphone, STT, TTS, and provider routing behavior.

#### Scenario: Other voice modes

- **WHEN** the effective mode is Direct, Operator, or Supervisor
- **THEN** assistant replies and transient output retain the existing chat-bubble presentation

#### Scenario: Change settings during a session

- **WHEN** a STT/TTS Harness session is active or reconnecting and the saved voice mode changes
- **THEN** the current session continues using the text output panel
- **AND** the new selection applies to the idle view and the next session

#### Scenario: Reload history while idle

- **WHEN** the user opens existing history with STT/TTS Harness selected
- **THEN** its assistant messages use the text output panel, including messages without historical mode metadata
- **AND** switching the idle selection back to Direct restores bubble presentation without rewriting messages

#### Scenario: Voice interaction remains available

- **WHEN** the user speaks or submits typed input during a STT/TTS Harness session
- **THEN** existing recognition, provider dispatch, audio playback, mute, and volume behaviors remain available alongside the output panel

### Requirement: Relay-level Harness component defaults

When a client selects STT/TTS Harness mode without naming its components, the system SHALL resolve the STT provider, TTS provider, and Harness from the local stack's declared configuration before failing, SHALL give client-supplied values precedence over that configuration, and SHALL keep failing with the existing required-component error when neither source provides a value.

#### Scenario: Client names every component

- **WHEN** `session.config` carries `mode: "stt-tts"` with `sttProvider`, `ttsProvider`, and `harness`
- **THEN** relay constructs exactly those components and the declared configuration is not consulted

#### Scenario: Client omits components but the local stack declares them

- **WHEN** `session.config` carries only `mode: "stt-tts"` and `harnessBinding`, and the relay's local configuration declares an STT provider, a TTS provider, and a Harness
- **THEN** relay constructs the declared components and the session starts as an STT/TTS Harness session

#### Scenario: Client and local configuration both omit a component

- **WHEN** neither `session.config` nor the relay's local configuration provides a required component
- **THEN** relay reports the existing `sttProvider is required when mode is stt-tts` style error for that component and no session starts

#### Scenario: A locally hosted provider is never implicit

- **WHEN** neither the client nor the local configuration names a provider
- **THEN** relay reports the missing component instead of selecting any provider, cloud or local, on its own

#### Scenario: The locally bundled stack declares cloud defaults

- **WHEN** the Desktop-owned local stack starts without an operator-declared provider
- **THEN** it declares the default cloud providers to its Relay, and a locally hosted provider is still used only when explicitly declared

### Requirement: Independent Harness selection

The system SHALL treat the Harness component as an independent setting from the Harness Provider binding, and SHALL NOT derive either value from the other.

#### Scenario: Harness and Provider differ

- **WHEN** the selected Harness Provider binding names provider `P` while the configured Harness is `H`
- **THEN** relay dispatches to `H` and keeps `P` only as the binding's provider identity

#### Scenario: Only one of the two is configured

- **WHEN** the Harness provider binding is configured but no Harness component is
- **THEN** the session reports the missing Harness component instead of inferring one from the binding

### Requirement: Fail-closed Harness startup

When a selected Harness component or voice provider cannot start, the system SHALL report a visible, actionable failure for that session and SHALL NOT silently substitute another provider or Harness.

#### Scenario: Selected provider runtime is unavailable

- **WHEN** the session's selected provider cannot be constructed or reached
- **THEN** relay reports the provider failure to the client and the session does not silently switch to another provider

#### Scenario: Selected TTS service stops after the session starts

- **WHEN** public screen output is available but the selected TTS service cannot synthesize its speech
- **THEN** the client keeps the public text readable, shows an actionable speech failure, and does not substitute another TTS provider

#### Scenario: Selected Harness is unavailable

- **WHEN** the session's selected Harness cannot accept the Turn
- **THEN** relay reports the Harness failure and offers its existing recovery choices instead of falling back to another pipeline

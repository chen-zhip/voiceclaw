## Purpose

Defines opt-in server-side diagnostics that make each STT/TTS Harness turn traceable across recognition, Harness dispatch, synthesis, and audio delivery without exposing binary media, secrets, or private reasoning.

## ADDED Requirements

### Requirement: Explicit diagnostic activation

The system SHALL emit STT/TTS debug output only when the operator explicitly enables it, and the bundled Desktop Relay SHALL honor the same activation setting as a standalone Relay.

#### Scenario: Debug output is disabled by default

- **WHEN** the operator does not explicitly enable STT/TTS debug output
- **THEN** the system emits no STT/TTS debug lines introduced by this capability

#### Scenario: Debug output is enabled

- **WHEN** the operator starts Relay with `VOICECLAW_STT_TTS_DEBUG=true`
- **THEN** Relay emits the diagnostic records required by this capability for STT/TTS Harness sessions

#### Scenario: Desktop launches the bundled Relay

- **WHEN** Desktop inherits `VOICECLAW_STT_TTS_DEBUG=true` and launches its bundled Relay
- **THEN** the launched Relay receives the activation setting and writes the same diagnostic output into the existing Relay service log

#### Scenario: Non-STT/TTS session runs while diagnostics are enabled

- **WHEN** an S2S session runs while STT/TTS debug output is enabled
- **THEN** the system emits no STT/TTS pipeline diagnostic records for that session

### Requirement: Correlated pipeline lifecycle output

For an STT/TTS Harness session, the system SHALL identify each diagnostic record as STT/TTS debug output, include the pipeline stage and event, include the session identifier, include the turn identifier whenever a turn exists, and include the relevant selected provider identifier whenever a provider participates.

#### Scenario: Session components connect

- **WHEN** an enabled STT/TTS Harness session selects and connects its STT, Harness, and TTS components
- **THEN** the diagnostics identify the session, each component role and identifier, and the start and outcome of component connection without recording its configuration values

#### Scenario: Audio reaches an STT boundary

- **WHEN** buffered microphone audio is committed or endpointing finalizes an utterance
- **THEN** the diagnostics record the session, endpoint reason, input byte count, configured sample rate, and recognition start without recording any audio or base64 payload

#### Scenario: STT recognition succeeds

- **WHEN** the STT Provider produces a final transcript
- **THEN** the diagnostics record the session, turn when allocated, provider, elapsed recognition time, transcript character count, and complete finalized transcript text

#### Scenario: Harness execution runs

- **WHEN** Relay dispatches finalized recognized text to the selected Harness and receives public speech output
- **THEN** the diagnostics record dispatch start, public speech-unit receipt, terminal outcome, elapsed time, and available session and turn correlation without recording private Provider reasoning

#### Scenario: TTS synthesis and delivery succeed

- **WHEN** Relay submits a complete public speech unit to the TTS Provider and streams the resulting audio to Desktop
- **THEN** the diagnostics record the complete submitted text, text character count, synthesis start and elapsed time, emitted chunk count and byte count, and successful completion with session, turn, and provider correlation

#### Scenario: Pipeline work is cancelled

- **WHEN** an enabled STT/TTS turn or session cancels pending recognition, Harness execution, synthesis, or delivery
- **THEN** the diagnostics identify the cancelled stage and available session and turn correlation without representing it as successful completion

#### Scenario: Pipeline stage fails

- **WHEN** component connection, recognition, Harness execution, synthesis, or delivery fails
- **THEN** the diagnostics identify the failed stage, available correlation, elapsed time when measured, and the actionable error while preserving the existing public failure behavior

### Requirement: Diagnostic content boundaries

Debug output SHALL include the complete finalized STT transcript and complete text submitted to TTS, but MUST NOT include microphone/audio payloads, synthesized audio/base64, credentials, tokens, bootstrap secrets, raw/private Provider reasoning, or unrestricted configuration objects.

#### Scenario: Approved text content is logged

- **WHEN** debug output is enabled and a transcript is finalized or text is submitted to TTS
- **THEN** the corresponding diagnostic record contains that complete text without truncation

#### Scenario: Binary media is processed

- **WHEN** Relay receives microphone audio or emits synthesized audio while debug output is enabled
- **THEN** diagnostics contain only bounded media metadata such as byte and chunk counts and never contain the audio bytes or their encoded representation

#### Scenario: Components are configured with secrets

- **WHEN** an enabled diagnostic session resolves component configuration containing credentials, tokens, paths, prompt configuration, or bootstrap material
- **THEN** diagnostics identify component roles and provider identifiers without serializing the configuration object or secret-bearing values

#### Scenario: Harness emits private reasoning

- **WHEN** raw or normalized private reasoning reaches the Harness boundary while debug output is enabled
- **THEN** diagnostics do not include that reasoning content and existing rejection or containment behavior remains unchanged

### Requirement: Diagnostic non-interference

STT/TTS debug output SHALL be observational only: it MUST NOT change Client events, component selection, ordering, retry behavior, audio delivery, transcript content, synthesis input, or pipeline timing acceptance, and a diagnostic sink failure MUST NOT fail the session.

#### Scenario: Enabled and disabled runs are compared

- **WHEN** the same deterministic STT/TTS interaction runs once with diagnostics disabled and once with diagnostics enabled
- **THEN** both runs expose the same ordered Client events and provider calls apart from diagnostic output

#### Scenario: Diagnostic sink fails

- **WHEN** the diagnostic sink throws or cannot persist a line
- **THEN** the STT/TTS pipeline continues its normal behavior and does not emit a new Client error for the logging failure

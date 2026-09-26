## ADDED Requirements

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

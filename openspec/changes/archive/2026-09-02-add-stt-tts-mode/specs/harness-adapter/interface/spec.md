## Purpose

Defines the legacy Relay-side scaffold implementation of the Harness Integration Contract used by the STT/TTS Harness Conversation Pipeline. Stable IDs and static declarations support deterministic composition, but do not claim a production Provider runtime or dynamic capability negotiation.

## ADDED Requirements

### Requirement: Harness Integration Contract scaffold

The system SHALL define a common scaffold boundary for Harness integrations.

#### Scenario: Boundary exposes capabilities
- **WHEN** relay creates a configured Harness boundary
- **THEN** the boundary MUST expose a capability declaration for the features it supports

#### Scenario: Boundary supports its lifecycle
- **WHEN** relay uses a configured Harness boundary
- **THEN** the boundary MUST support connection, message submission, and disconnection

### Requirement: Static capability declaration

Each registered Harness scaffold SHALL expose a static capability declaration separately from its runtime availability. These legacy declarations are build-time routing hints and MUST NOT be presented as dynamically negotiated Provider semantics.

#### Scenario: Check structured output declaration
- **WHEN** relay reads `adapter.capabilities.structuredOutput`
- **THEN** the declared value is `true`, `"partial"`, or `false` according to the registered scaffold profile

#### Scenario: Registration does not imply availability
- **WHEN** an adapter ID and static declaration are registered but no runnable Provider boundary is configured
- **THEN** relay reports the adapter as unavailable

#### Scenario: Recovery Guidance for missing features
- **WHEN** the selected available Harness boundary does not support a requested optional feature
- **THEN** relay reports actionable Recovery Guidance without silently switching Provider, Harness, or Conversation Pipeline

### Requirement: Structured output protocol

The system SHALL request and parse structured output from Harness tools.

#### Scenario: Request structured format
- **WHEN** relay submits a message through the Harness Integration Contract boundary
- **THEN** the boundary MUST inject structured output instructions into the Harness prompt

#### Scenario: Parse thinking/speech/text
- **WHEN** Harness returns JSON with `thinking`, `speech`, and `text` fields
- **THEN** the boundary parses and emits separate incremental chunks for those streams

#### Scenario: Handle non-compliant output
- **WHEN** Harness returns plain text instead of structured JSON
- **THEN** adapter treats it as `speech` content and synthesizes matching `text`

### Requirement: Stream cancellation

The system SHALL support aborting in-flight Harness requests.

#### Scenario: Cancel via stream handle
- **WHEN** relay calls `handle.cancel()` on an active stream
- **THEN** adapter aborts HTTP request and stops emitting chunks

#### Scenario: Abort signal propagation
- **WHEN** user interrupts (future feature) or session disconnects
- **THEN** all active Harness streams MUST be cancelled within 500ms

### Requirement: Interruption support

The system SHALL allow capable adapters to handle user interruptions with context.

#### Scenario: Interrupt and resume
- **WHEN** relay requests interruption with context from a supporting Harness boundary
- **THEN** the boundary cancels the current stream and resumes with interruption context

#### Scenario: Guidance for non-supporting boundaries
- **WHEN** the selected Harness boundary declares interruption unavailable
- **THEN** relay may cancel the current stream and reports Recovery Guidance for explicit resubmission without automatically restarting it

### Requirement: Overlay query support

The system SHALL allow capable adapters to handle parallel queries without interrupting main flow.

#### Scenario: Overlay query on supporting boundary
- **WHEN** relay requests an overlay query from a supporting Harness boundary
- **THEN** the boundary handles the query independently and returns a quick response

#### Scenario: Fallback for non-supporting boundaries
- **WHEN** the selected Harness boundary declares overlay queries unavailable
- **THEN** relay either blocks main flow or rejects overlay query

### Requirement: Harness boundary registration

The system SHALL maintain stable known Harness boundary IDs separately from runnable availability.

#### Scenario: List known Harness boundaries
- **WHEN** system initializes
- **THEN** registry contains stable known IDs for Claude Code, Codex, and Cherry Studio and separately reports whether each runtime is available

#### Scenario: Create boundary by ID
- **WHEN** session config specifies a known `harnessId` whose runnable boundary is configured
- **THEN** registry creates the corresponding scaffold boundary

#### Scenario: Known adapter is not runnable
- **WHEN** session config specifies a known `harnessId` whose production runtime is not available
- **THEN** relay rejects creation with an actionable unavailable status rather than treating registration as readiness

#### Scenario: Unknown adapter ID
- **WHEN** session config specifies unknown `harnessId`
- **THEN** relay sends `error` event listing available adapter IDs

### Requirement: Error reporting

The system SHALL provide actionable error messages for Harness integration failures.

#### Scenario: Connection refused
- **WHEN** the configured Harness gateway cannot be reached
- **THEN** the error identifies the configured boundary, provides Recovery Guidance for explicit resubmission or Conversation Pipeline selection, and MUST NOT recommend an unverified or unsupported Provider startup command

#### Scenario: Authentication failure
- **WHEN** adapter receives 401/403 from Harness
- **THEN** error message explains credential requirement and where to configure it

### Requirement: Trace propagation

The system SHALL propagate an active OpenTelemetry trace context supplied at the Harness HTTP boundary.

#### Scenario: Inject traceparent header
- **WHEN** the Harness HTTP boundary is invoked with an active OpenTelemetry trace context
- **THEN** the request MUST include a `traceparent` header derived from that context

#### Scenario: No active context supplied
- **WHEN** the Harness HTTP boundary is invoked without an active trace context
- **THEN** the boundary proceeds without inventing a Relay turn-span binding

#### Scenario: Unified trace in Langfuse
- **WHEN** the caller supplies a Relay trace context and Harness emits its own trace spans
- **THEN** Harness spans can appear as children of the supplied Relay trace; binding every production turn to that context belongs to the production Integration Plugin change

### Requirement: Timeout handling

The system SHALL enforce reasonable timeouts on Harness operations.

#### Scenario: Default query timeout
- **WHEN** Harness does not respond within 120 seconds
- **THEN** adapter cancels request and returns timeout error

#### Scenario: Overlay query fast timeout
- **WHEN** overlay query does not respond within 3 seconds
- **THEN** adapter cancels and returns empty response (main flow unaffected)

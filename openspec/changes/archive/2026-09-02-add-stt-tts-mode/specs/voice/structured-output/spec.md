## Purpose

Defines non-mutating Relay routing for executor-authored Semantic Output separated into private thinking, concise speech, detailed text, and presentation metadata such as screen references.

## ADDED Requirements

### Requirement: Output structure definition

The system SHALL define a structured output format with three distinct streams.

#### Scenario: Complete structured output
- **WHEN** Harness generates a response
- **THEN** output MUST be parseable JSON with `thinking`, `speech`, and `text` fields

#### Scenario: Minimal valid output
- **WHEN** Harness provides only required fields
- **THEN** `speech` field alone is sufficient (thinking and text are optional)

### Requirement: Thinking stream

The system SHALL capture internal reasoning without exposing it to user interfaces.

#### Scenario: Store thinking content
- **WHEN** Harness output includes `thinking: { steps: [...], reasoning: "..." }`
- **THEN** relay saves it only when local capture is enabled, exports metadata-only tracing by default, and does NOT send the content to a Client

#### Scenario: Thinking is optional
- **WHEN** Harness output omits `thinking` field
- **THEN** relay continues processing speech and text normally

### Requirement: Speech stream

The system SHALL preserve Harness-authored speech content and route it to TTS for verbal output.

#### Scenario: Stream speech to TTS
- **WHEN** Harness emits `speech: { content: "I found 3 bugs..." }`
- **THEN** relay forwards content to TTS provider and emits `audio.delta` events

#### Scenario: Speech references screen
- **WHEN** speech content includes natural references like "the table on screen shows..."
- **THEN** TTS produces natural-sounding audio with those references intact

#### Scenario: Structured speech remains streamable
- **WHEN** Harness-authored speech contains code blocks, tables, lists, or fragments of those structures split across transport chunks
- **THEN** relay MAY record a server-side warning but MUST preserve the complete speech and continue routing it to TTS without suppression, truncation, or rewriting based on chunk boundaries

### Requirement: Text stream

The system SHALL route text content to client for screen display.

#### Scenario: Display structured text
- **WHEN** Harness emits `text: { content: "## Results\n...", format: "markdown" }`
- **THEN** relay emits `transcript.delta` events tagged with `source: "text"`

#### Scenario: Text equals speech fallback
- **WHEN** Harness output omits `text` field
- **THEN** relay duplicates `speech.content` as text output (simple mode)

### Requirement: Screen references

The system SHALL support explicit cross-references between speech and text sections.

#### Scenario: Speech references text section
- **WHEN** speech includes `screenReferences: [{ at: 42, type: "look", target: "section-id" }]`
- **THEN** relay emits `screen.highlight` event at character position 42

#### Scenario: Text sections with IDs
- **WHEN** text includes `sections: [{ id: "section-id", title: "Results", content: "..." }]`
- **THEN** relay emits `text.section` events with section metadata

#### Scenario: Highlight synchronization
- **WHEN** the TTS boundary reports playback progress crossing the character position of a screen reference
- **THEN** relay emits a `screen.highlight` presentation event; precise Client playback-time synchronization and rendering are outside this change

### Requirement: Streaming output

The system SHALL support incremental delivery of structured output.

#### Scenario: Stream speech chunks
- **WHEN** Harness emits `{ type: "speech.delta", content: "I found" }`
- **THEN** relay buffers the delta into a sentence accumulator

#### Scenario: Sentence boundary synthesis
- **WHEN** accumulated speech reaches a sentence boundary (`.`, `!`, `?`, `。`, `！`, `？`)
- **THEN** relay synthesizes the complete sentence via TTS and clears the accumulator

#### Scenario: Stream text chunks
- **WHEN** Harness emits `{ type: "text.delta", content: "## Results\n" }`
- **THEN** relay immediately emits `transcript.delta` to client

#### Scenario: Complete signal
- **WHEN** Harness emits `{ type: "complete", output: {...} }`
- **THEN** relay finalizes all streams and emits `turn.ended`

### Requirement: Format support

The system SHALL preserve supported content-format metadata in the text stream without claiming Client rendering behavior.

#### Scenario: Markdown formatting
- **WHEN** text field specifies `format: "markdown"`
- **THEN** relay emits the content with `format: "markdown"` intact

#### Scenario: Plain text formatting
- **WHEN** text field specifies `format: "plain"` or omits format
- **THEN** relay normalizes the format to `plain` and emits the content with plain-text presentation metadata

#### Scenario: Invalid text formatting
- **WHEN** text field specifies an unsupported or malformed format
- **THEN** relay normalizes the format to `plain`, preserves the authored content, and records a server-side warning

#### Scenario: Code formatting
- **WHEN** text field specifies `format: "code"` with language metadata
- **THEN** relay preserves both `format: "code"` and the language metadata in the emitted event

### Requirement: Output separation rules

The system SHALL validate output separation and report warnings without silently rewriting executor-authored Semantic Output.

#### Scenario: Speech is concise
- **WHEN** validating speech content length
- **THEN** relay warns if speech exceeds 500 characters but preserves the authored content

#### Scenario: Text is detailed
- **WHEN** text includes structured data (tables, code, lists)
- **THEN** relay may warn when speech duplicates it but MUST NOT silently change the executor's conclusion or content

#### Scenario: Separation checks do not filter speech
- **WHEN** a separation check detects structured or detailed content in speech
- **THEN** relay MAY record a server-side warning but MUST NOT suppress, truncate, or rewrite the speech sent to TTS

### Requirement: Semantic output ownership

The system SHALL preserve the meaning and conclusions authored by the active Harness while validating and routing its output.

#### Scenario: Valid structured output is routed unchanged
- **WHEN** Harness emits valid speech and text fields
- **THEN** relay preserves their semantic content while adding only presentation and routing state

#### Scenario: Presentation state is non-semantic
- **WHEN** relay emits progress, synthesis, section, or highlight events
- **THEN** those events MUST NOT alter or replace the Harness-authored task result

### Requirement: Emotion and prosody hints

The system SHALL support TTS modulation through speech metadata.

#### Scenario: Emotion hint
- **WHEN** speech includes `emotion: "concerned"`
- **THEN** TTS provider adjusts tone (if supported) or logs hint for future use

#### Scenario: Speed hint
- **WHEN** speech includes `speed: 1.2`
- **THEN** TTS provider adjusts speaking rate to 1.2x normal speed

### Requirement: Error handling

The system SHALL handle malformed structured output gracefully.

#### Scenario: Invalid JSON
- **WHEN** Harness returns non-JSON text
- **THEN** relay preserves the entire output as speech and text content instead of inventing a replacement answer

#### Scenario: Missing required field
- **WHEN** structured output omits `speech` field
- **THEN** relay logs warning and uses `text` content as speech fallback

#### Scenario: Schema validation
- **WHEN** structured output has unexpected field types
- **THEN** relay coerces to expected types or falls back to plain text mode

## Purpose

Provides explicitly enabled local JSONL diagnostics for private Harness thinking while keeping tracing metadata-first and preventing private content from entering Client projections or the Conversation Archive.

## ADDED Requirements

### Requirement: Storage location

The system SHALL store thinking chains in user home directory.

#### Scenario: Default storage path
- **WHEN** thinking storage initializes without custom path
- **THEN** files are written to `~/.voiceclaw/thinking/`

#### Scenario: Custom storage path
- **WHEN** environment variable `VOICECLAW_THINKING_DIR` is set
- **THEN** files are written to specified directory

### Requirement: Opt-in capture

The system SHALL require explicit opt-in for thinking chain storage.

#### Scenario: Default disabled
- **WHEN** `VOICECLAW_THINKING_CAPTURE` is not set or set to any value other than "enabled"
- **THEN** thinking chains are NOT written to disk (privacy by default)

#### Scenario: Explicit enable
- **WHEN** `VOICECLAW_THINKING_CAPTURE=enabled`
- **THEN** thinking chains are written to local JSONL files

### Requirement: File format

The system SHALL store thinking chains in JSONL (JSON Lines) format.

#### Scenario: One entry per turn
- **WHEN** Harness completes a turn with thinking output
- **THEN** one JSON object is appended to session file on a new line

#### Scenario: File per session
- **WHEN** multiple turns occur in one session
- **THEN** all thinking entries append to `<sessionId>.jsonl`

### Requirement: Entry structure

The system SHALL store complete context for each thinking entry.

#### Scenario: Complete thinking entry
- **WHEN** writing a thinking entry
- **THEN** JSON object MUST include `sessionId`, `turnId`, `timestamp`, `thinking`, `userQuery`, and `finalOutput`

#### Scenario: Thinking content structure
- **WHEN** thinking field is present
- **THEN** it MUST include `steps` (array), `reasoning` (string), and optionally `confidence` (number 0-1)

### Requirement: Append-only writes

The system SHALL use append-only writes to prevent data loss.

#### Scenario: Concurrent writes
- **WHEN** multiple turns complete simultaneously
- **THEN** each write appends atomically without corrupting file

#### Scenario: Partial write recovery
- **WHEN** system crashes during write
- **THEN** existing entries remain intact (only incomplete last line may be lost)

### Requirement: File reading

The system SHALL support reading thinking chains for analysis.

#### Scenario: Load session thinking
- **WHEN** loading thinking for a specific session
- **THEN** system reads `<sessionId>.jsonl` and parses each line as JSON

#### Scenario: Handle corrupted lines
- **WHEN** file contains malformed JSON lines
- **THEN** system skips invalid lines and continues parsing valid entries

### Requirement: Langfuse integration

The system SHALL keep thinking trace export metadata-only by default and require a separate explicit diagnostic opt-in before exporting redacted thinking content.

#### Scenario: Attach safe thinking metadata to trace
- **WHEN** thinking is captured during a turn
- **THEN** relay records presence, size, classification, and capture status without exporting steps or reasoning content

#### Scenario: Content tracing remains separately disabled
- **WHEN** local thinking capture is enabled but `VOICECLAW_TRACE_CONTENT` is absent or is not exactly `enabled`
- **THEN** Langfuse spans MUST NOT include `thinking.steps` or `thinking.reasoning` content

#### Scenario: Explicit diagnostic content tracing
- **WHEN** local thinking capture is enabled and `VOICECLAW_TRACE_CONTENT=enabled`
- **THEN** relay replaces each exact occurrence of a non-empty active Provider `apiKey`, `authToken`, or `token` value with `[REDACTED]` and exports only the authorized thinking fields

#### Scenario: Thinking URL in event
- **WHEN** thinking is saved locally
- **THEN** relay emits `thinking.saved` metadata with `localPath` and an optional `tracePath`, without embedding thinking content

### Requirement: Privacy preservation

The system SHALL ensure thinking chains never reach user-facing interfaces.

#### Scenario: No thinking in transcript
- **WHEN** relay processes thinking output
- **THEN** thinking content MUST NOT appear in `transcript.delta` or `transcript.done` events

#### Scenario: No thinking in audio
- **WHEN** TTS synthesizes output
- **THEN** thinking content MUST NOT be included in speech synthesis

#### Scenario: No thinking in conversation archive
- **WHEN** Relay persists or imports conversation history
- **THEN** private thinking content MUST NOT be written to the Conversation Archive

#### Scenario: Debug access only
- **WHEN** user wants to view thinking chains
- **THEN** they MUST explicitly read files from `~/.voiceclaw/thinking/` (not exposed in UI by default)

### Requirement: Disk space management

The system SHALL provide reasonable disk usage limits.

#### Scenario: File rotation
- **WHEN** thinking directory size exceeds 1GB(adjustable)
- **THEN** older half of files are conpressed in high level automatically

#### Scenario: File age limit
- **WHEN** thinking files are older than 30 days
- **THEN** they are candidates for automatic deletion

#### Scenario: Manual cleanup
- **WHEN** user runs cleanup command (future feature)
- **THEN** thinking files older than specified age are deleted

### Requirement: Performance

The system SHALL not block turn completion on disk writes.

#### Scenario: Async writes
- **WHEN** thinking entry is ready to write
- **THEN** write operation happens asynchronously (does not delay `turn.ended` event)

#### Scenario: Write failure handling
- **WHEN** disk write fails (permissions, full disk, etc.)
- **THEN** error is logged but turn continues normally (thinking loss is non-fatal)

### Requirement: Notification events

The system SHALL notify client when thinking is saved.

#### Scenario: Thinking saved event
- **WHEN** thinking is successfully written to disk
- **THEN** relay emits `thinking.saved` event with file path and trace URL

#### Scenario: Optional client display
- **WHEN** client receives `thinking.saved` event
- **THEN** client MAY show debug indicator but MUST NOT auto-display thinking content

### Requirement: Data retention policy

The system SHALL allow users to delete thinking data.

#### Scenario: Session cleanup
- **WHEN** user deletes a session
- **THEN** corresponding `<sessionId>.jsonl` file is also deleted

#### Scenario: Complete wipe
- **WHEN** user requests complete thinking data deletion
- **THEN** entire `~/.voiceclaw/thinking/` directory is removed

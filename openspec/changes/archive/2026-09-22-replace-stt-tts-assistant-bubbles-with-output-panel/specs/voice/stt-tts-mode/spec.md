## ADDED Requirements

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

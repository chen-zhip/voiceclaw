## Purpose

Defines a coherent, conversation-centered Desktop shell that keeps VoiceClaw navigation and voice controls clear across window sizes and themes while preserving existing product behavior.

## ADDED Requirements

### Requirement: Desktop destination navigation

Desktop SHALL present Chat, History, and Settings in a persistent navigation area at regular desktop widths. The current destination SHALL have a visible selected state, and activating a destination SHALL show its existing page without discarding an in-progress chat session.

#### Scenario: Navigate among primary destinations

- **WHEN** the user activates Chat, History, or Settings from the navigation area
- **THEN** the corresponding page becomes the visible main content
- **AND** the selected navigation item is visually and programmatically identifiable

#### Scenario: Preserve an active chat while visiting another destination

- **WHEN** the user leaves Chat during an active or connecting session and later returns
- **THEN** the existing session and conversation state remain available according to current session behavior
- **AND** the Chat destination becomes selected again

#### Scenario: Use existing keyboard navigation

- **WHEN** the user invokes an existing destination shortcut
- **THEN** the same destination becomes visible and selected as if its navigation item had been activated

### Requirement: Conversation-centered workspace

Desktop SHALL give the conversation a centered readable column, a quiet page header, and a composer that remains visually anchored near the bottom of the workspace. Assistant output, user messages, tool activity, errors, attachments, and jump-to-latest behavior SHALL remain readable and operable within that composition.

#### Scenario: Read a conversation at desktop width

- **WHEN** Chat is displayed at a regular desktop width
- **THEN** conversation content is centered with bounded line length and balanced side space
- **AND** the header and composer do not cover transcript content

#### Scenario: Compose a message

- **WHEN** the composer is idle, focused, contains multiple lines, or shows pending attachments
- **THEN** its primary input and send, attach, model, and voice-related actions remain visible or reachable
- **AND** the transcript retains enough bottom space to keep the latest message readable above the composer

#### Scenario: Use voice controls

- **WHEN** a call is connecting or active
- **THEN** call state, microphone, output audio, volume, screen-sharing, and end-call actions remain reachable from the conversation workspace
- **AND** their enabled, disabled, muted, and active states remain distinguishable

### Requirement: Responsive desktop shell

Desktop SHALL adapt its navigation and conversation layout when the window becomes narrow. The narrow layout SHALL avoid horizontal page overflow and SHALL keep primary destinations and conversation actions accessible without requiring the permanent full-width navigation rail.

#### Scenario: Narrow the application window

- **WHEN** the content area no longer fits the expanded navigation and readable conversation column
- **THEN** navigation changes to a compact or temporary presentation
- **AND** the transcript, composer, and call controls fit within the available width without horizontal scrolling

#### Scenario: Restore desktop width

- **WHEN** the window returns to a regular desktop width
- **THEN** the persistent navigation area and centered conversation composition return
- **AND** the current destination and conversation state are preserved

### Requirement: Cohesive theme and interaction states

Desktop SHALL use a restrained neutral surface hierarchy, subtle separators and selection fills, consistent spacing and radii, and a VoiceClaw accent used for status and emphasis. Dark, light, and system-selected themes SHALL preserve readable contrast and the same information hierarchy.

#### Scenario: Change theme

- **WHEN** the user selects dark, light, or system theme
- **THEN** the shell, navigation, pages, transcript, composer, overlays, and controls use the corresponding theme tokens
- **AND** text, focus indicators, selected states, errors, and disabled controls remain distinguishable

#### Scenario: Navigate with a keyboard

- **WHEN** the user tabs through navigation and conversation controls
- **THEN** focus follows a logical order and each interactive element has a visible focus indicator
- **AND** icon-only controls expose an accessible name

#### Scenario: Reduce motion

- **WHEN** the operating system requests reduced motion
- **THEN** layout and state changes remain understandable without nonessential animated movement

### Requirement: Existing page and voice behavior continuity

The refreshed shell SHALL preserve existing Chat, History, Settings, onboarding, update, STT/TTS text-panel, attachment, provider, and conversation behaviors except for their visual layout and styling.

#### Scenario: Display STT/TTS Harness output

- **WHEN** STT/TTS Harness is the effective voice mode
- **THEN** assistant replies continue to use the full-width text output panel rather than assistant bubbles
- **AND** streaming, waiting, copy, attachment, metadata, and scrolling behavior remain available

#### Scenario: Use History and Settings

- **WHEN** the user opens, filters, selects, deletes, or resumes history, or changes a setting
- **THEN** the existing action produces the same result under the refreshed presentation

#### Scenario: Show onboarding or an update notice

- **WHEN** onboarding is required or an update banner is available
- **THEN** the existing flow remains reachable, readable, and operable within or above the refreshed shell

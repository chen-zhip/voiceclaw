## Why

VoiceClaw Desktop currently presents Chat, History, and Settings as top-level tabs with dense, utility-first surfaces. The requested refresh should make the app feel closer to the calm, conversation-centered ChatGPT Desktop layout shown in the supplied reference while preserving VoiceClaw's identity and voice-specific controls.

## What Changes

- Replace the top tab bar with a persistent desktop navigation rail that exposes Chat, History, and Settings, highlights the current destination, and can collapse for narrower windows.
- Recompose the chat workspace around a centered reading column, a quiet title/action bar, and a floating rounded composer anchored near the bottom.
- Apply a restrained neutral visual system across Chat, History, and Settings: near-black and soft-gray surfaces, subtle selection states, consistent radii, compact utility labels, and clear focus states in both dark and light themes.
- Keep VoiceClaw branding, conversation behavior, STT/TTS output-panel semantics, attachments, call controls, errors, and settings functions intact while changing their visual hierarchy and placement.
- Adapt the shell at narrow widths so navigation and primary conversation actions remain reachable without horizontal overflow.
- Treat the reference as a style and interaction-direction guide; do not copy ChatGPT trademarks, proprietary assets, or product-specific navigation items.

## Capabilities

### New Capabilities

- `desktop/interface-shell`: Defines the visible desktop shell, navigation, conversation workspace, responsive behavior, theme treatment, and accessibility expectations for the refreshed UI.

### Modified Capabilities

- None. Existing voice, Harness, archive, and provider behavior remains unchanged.

## Impact

- Affects the Desktop renderer shell and shared presentation components, primarily `App.tsx`, `TabBar.tsx` or its replacement, `ChatPage.tsx`, `ChatComposer.tsx`, `HistoryPage.tsx`, `SettingsPage.tsx`, and global theme styles.
- May introduce renderer-only layout primitives, design tokens, and component tests; it does not change Relay protocols, provider routing, persisted conversation data, or public IPC contracts.
- Requires visual acceptance in the real Electron window at normal and narrow widths, in dark and light themes, in addition to public DOM behavior checks.

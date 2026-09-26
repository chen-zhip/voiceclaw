## Context

See `proposal.md` for motivation. The renderer currently uses a horizontal `TabBar`, keeps all three destination pages mounted, and composes Chat as a full-width transcript followed by a conventional bordered composer and a separate call-control footer. Global theme tokens use a warm paper/rust visual language and a background grid. The supplied reference instead uses a dark, low-contrast navigation rail, a quiet near-black workspace, a centered transcript, and a rounded floating composer.

The implementation must preserve the mounted-page behavior in `App.tsx`, the current navigation shortcuts, onboarding gate, update banner, conversation context, voice-session lifecycle, and the STT/TTS assistant output-panel contract. Fixed comparison point for final `$code-review`: `2264f0af6186abd25cf8185d635cf049f6ad3239`. Existing worktree changes at planning time must be recorded separately before implementation so review does not attribute them to this change.

## Goals / Non-Goals

**Goals:**

- Establish one desktop shell and token system shared by Chat, History, and Settings.
- Make the conversation the visual center while retaining quick access to voice and desktop-specific actions.
- Keep normal-width and narrow-window layouts deliberate rather than relying on accidental wrapping.
- Provide public component and page seams for navigation, responsive state, theme state, and composer/control reachability, followed by real Electron visual acceptance.

**Non-Goals:**

- Recreate ChatGPT branding, copy its proprietary assets, or add destinations shown only in the reference.
- Change conversation persistence, provider selection, Relay protocols, IPC contracts, or call semantics.
- Redesign onboarding as part of the main-shell refresh beyond ensuring it still displays correctly.
- Introduce a web-font download or a new runtime UI framework.

## Decisions

### 1. Replace the top tab bar with a shell-owned navigation rail

Create a shell component that owns the expanded, compact, and temporary navigation presentations while `App` continues to own `activeTab` and the existing mounted page containers. At regular width, the rail is approximately 248–272 px and carries VoiceClaw identity, a primary “New chat” action, Chat, History, Settings, and compact status/account affordances supported by the product. At narrow width it collapses behind a clearly named menu control or becomes a compact icon rail; opening it must not resize the transcript into an unusable sliver.

Keeping destination state in `App` avoids a routing migration and preserves current keyboard shortcuts. A CSS-only wrapping of `TabBar` was rejected because it cannot provide an accessible temporary navigation surface or coordinate the main content inset.

### 2. Use a centered reading column inside a full-height workspace

Chat retains one scroll owner. The transcript gets an inner reading column with a target maximum width around 760–860 px while full-width notices and overlays remain explicitly placed. A slim header shows the conversation title and contextual actions without becoming a second navigation bar. The composer sits in a bottom workspace dock with transcript padding derived from the dock height, so multi-line input, attachments, and call controls never cover the latest content.

Absolute positioning without reserved transcript space was rejected because composer growth would obscure output and destabilize jump-to-latest calculations.

### 3. Fold voice state into a restrained composer dock

Keep `ChatComposer`, attachment tray, and existing call controls as behavior owners, but present them as one visual dock. Idle state emphasizes text entry and a compact call entry action. Connecting and active states reveal a secondary voice-control row within the dock rather than a separate full-width footer. The VoiceClaw-specific signature is a thin copper “signal line” along the dock edge when a call is connecting or active; it reflects existing state and adds no new session behavior. Reduced-motion mode removes any pulsing treatment.

A permanently expanded control bar was rejected because it competes with the transcript when voice controls are inactive.

### 4. Replace the warm grid with a disciplined neutral token set

Use semantic variables so components do not embed reference-specific colors:

| Token role       | Dark      | Light     |
| ---------------- | --------- | --------- |
| Workspace        | `#181818` | `#F7F7F5` |
| Navigation       | `#111827` | `#ECECEA` |
| Raised surface   | `#2F2F2F` | `#FFFFFF` |
| Selected surface | `#343A46` | `#DDDDDA` |
| Primary text     | `#F3F4F6` | `#202123` |
| VoiceClaw signal | `#D86A4D` | `#B4492F` |

Body and control typography use the existing system/Inter stack for a compact desktop cadence. Fraunces is reserved for the VoiceClaw identity or rare empty-state heading, and JetBrains Mono remains limited to technical status/data. The background grid and decorative radial wash are removed from the main application shell. Borders become low-contrast separators; shadows are reserved for the floating composer and temporary navigation.

Using a pure black/white clone was rejected because it would erase VoiceClaw identity and make status distinctions depend on copied brand treatment.

### 5. Restyle pages through shared layout primitives before local exceptions

Introduce small renderer-only primitives or class contracts for shell sections, page headers, scroll bodies, content columns, panels, and selected rows. History becomes a quiet list/detail surface aligned to the same content rhythm. Settings uses grouped sections and restrained dividers instead of unrelated card treatments. Existing controls keep their names, events, and data flow.

Rewriting each page independently was rejected because spacing, focus, responsive, and theme behavior would drift.

### 6. Verify public behavior and real-window composition separately

Component/page tests should verify selected navigation state, destination activation, preserved mounted Chat state, narrow navigation reachability, composer/control availability, and theme/accessibility state through visible roles and labels. Existing STT/TTS panel tests remain the regression boundary for presentation semantics. Real Electron acceptance covers pixel-dependent composition at representative desktop and narrow widths, dark/light/system themes, long conversations, empty states, settings density, history actions, attachments, active-call controls, and no horizontal overflow.

DOM tests alone were rejected for width, layering, and visual hierarchy acceptance because the test environment does not perform real layout.

## Risks / Trade-offs

- [The floating dock can obscure the newest transcript content as it grows] → Measure or centrally define dock spacing and verify multi-line input plus attachments and active-call rows in Electron.
- [A persistent rail reduces conversation width on small windows] → Switch at an explicit layout threshold to compact or temporary navigation and retain one transcript scroll owner.
- [Global token changes can regress onboarding or overlays] → Scope main-shell tokens where possible, preserve onboarding tokens, and inspect banners, menus, pickers, and call bar in both themes.
- [Keeping all pages mounted can leave hidden controls in the accessibility tree] → Preserve the current hidden-page semantics and add shell tests that only the active destination is exposed and interactive.
- [Reference fidelity can become imitation] → Use the reference for density, hierarchy, and composition while keeping VoiceClaw marks, voice status, vocabulary, and accent treatment.
- [The dirty worktree can blur review attribution] → Capture focused pre-change diffs and use the fixed comparison point plus recorded baseline during final review.

## Migration Plan

1. Capture the affected renderer baseline and add shell-level behavior fixtures without changing product behavior.
2. Introduce semantic tokens and shared shell/layout primitives behind the existing `activeTab` state.
3. Move destination navigation into the shell, then migrate Chat composition and its responsive dock.
4. Apply shared page structure to History and Settings while preserving their actions.
5. Run renderer tests, typecheck, production build, strict OpenSpec validation, and real Electron visual acceptance.
6. Roll back by restoring the previous shell and token mappings; no stored data or protocol migration is required.

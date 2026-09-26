# Real-window acceptance

Date: 2026-09-23
Host: Windows, VoiceClaw Electron development build

## Window and layout coverage

- At 1188×794, the persistent VoiceClaw navigation rail, quiet page header, centered transcript, full-width assistant output panels, and bottom composer remained visually separate with no horizontal overflow or covered content. A populated 52-message conversation exercised long scrolling, grouped messages, multiline output, unbroken text wrapping, and jump-to-latest behavior in the single transcript region.
- At 694×794, navigation changed to the named menu button and modal drawer. Chat, History, and Settings remained reachable; selecting a destination closed the drawer; Escape restored focus; keyboard focus stayed inside the open drawer. The transcript and composer continued to fit without horizontal scrolling.
- Returning to the regular width restored the navigation rail while preserving the selected destination and mounted Chat state.
- The Windows host cannot render macOS window controls. The macOS narrow-window title-bar inset is therefore covered by the platform-specific renderer regression test rather than claimed as a Windows visual result.

## Conversation and voice coverage

- A two-line Chinese draft made the composer grow upward while attach, model, voice, and send actions remained visible. Adding `desktop/resources/dock/icon.png` displayed the attachment tray above the draft with its remove action and did not cover the transcript.
- The idle call action was reachable from the composer. Starting a real call exposed the connecting controls; the missing local Harness Integration Contract boundary produced the expected error inside the dock without breaking layout.
- The development-only `?interface-preview=active` state rendered active-call status together with microphone, screen-share, volume, and end-call actions in the real Electron window. Controls remained distinct and did not overlap at 1188×794.
- The STT/TTS Harness path retained the existing full-width assistant text panel. Its streaming/waiting, copy, attachment/metadata, scrolling, and ordinary-message fallback behaviors remain covered by the renderer regression suite used with this visual acceptance.

## Pages, overlays, themes, and accessibility

- History showed its header, count, bounded list rows, resume behavior, and delete affordance without overflow. Settings kept a fixed header and independently scrolling grouped content; provider, voice, audio, appearance, call-bar, shortcut, update, debug, and STT/TTS Harness settings stayed inside the shared content column.
- Dark, light, and system appearance choices were exercised in the real window. Navigation selection, text, dividers, form controls, focus indicators, disabled states, and destructive actions remained distinguishable; the original system preference was restored.
- `?onboarding=1` displayed the onboarding flow at 1188×794 without clipping. The development-only `?interface-preview=update` state displayed the update banner and its What's new, Later, and Restart now actions above the refreshed shell without covering the page.
- Keyboard Tab navigation showed the copper focus ring on the attachment action and followed the visible navigation/composer order. Hidden Chat shortcuts were separately exercised by regression tests so inactive destinations cannot trigger them.
- Chromium Rendering emulation set `prefers-reduced-motion` to `reduce`; `matchMedia('(prefers-reduced-motion: reduce)').matches` returned `true`, and state/layout changes remained understandable without the nonessential pulse animation.

## Result

All visually testable scenarios in task 5.1 passed in the real Windows Electron window at the representative sizes above. Platform-specific macOS placement and behavioral edge cases that do not have a Windows visual equivalent are covered by focused renderer tests.

## Why

An STT/TTS Harness session cannot start today. Desktop's `resolveHarnessSelection()` sends only `mode` and `harnessBinding`, so the Relay answers `sttProvider is required when mode is stt-tts`; nothing in Desktop writes the STT provider, TTS provider, or harness id; and the bundled Relay is never given the cloud provider credentials it would need. The local stack accepts the Codex Contribution and reports binding readiness, so the missing piece is the Harness configuration surface itself (tech-debt #06).

## What Changes

- The Relay resolves `sttProvider`, `ttsProvider`, and `harness` for `mode: 'stt-tts'` from the local stack's declared environment when the client does not name them: `VOICECLAW_STT_PROVIDER`, `VOICECLAW_TTS_PROVIDER`, `VOICECLAW_HARNESS_ID`. Client-supplied values always win; the existing `… is required when mode is stt-tts` error text is unchanged when both are empty.
- Default cloud providers (`deepgram`, `elevenlabs`) apply only through that fallback. The local `gpt-sovits-stt` / `gpt-sovits-tts` providers are never chosen implicitly.
- The Harness id is an independent setting from the Harness Provider binding; neither is derived from the other.
- Desktop forwards `VOICECLAW_STT_PROVIDER`, `VOICECLAW_TTS_PROVIDER`, `VOICECLAW_HARNESS_ID`, `DEEPGRAM_API_KEY`, and `ELEVENLABS_API_KEY` to the bundled Relay so the same fallback works there.
- Desktop Settings gains `harness_stt_provider`, `harness_tts_provider`, and `harness_id`; `resolveHarnessSelection()` reads all six values and sends them in `session.config`, and stops sending the hardcoded `voiceMode: 'direct'`.
- The selection logic moves to a unit-testable module with per-field, actionable messages for every missing value.
- Out of scope: provider selection UI beyond the three new fields and non-Codex Harnesses. A selected TTS provider's synthesis failure is reported visibly without substituting another provider.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `voice/stt-tts-mode`: adds the Relay-level component defaults a locally bundled stack relies on, and states that the Harness id is configured independently from the Harness Provider binding.

## Impact

- `relay-server/src/adapters/index.ts`: component resolution gains the environment fallback; the required-component error text stays as it is.
- `relay-server/test/adapters/factory-stt-tts.test.ts`: three new cases (fallback constructs, client value wins, both empty still throws).
- `desktop/src/main/services/relay-server.ts`: forwarded environment allow-list gains the five keys above.
- `desktop/src/renderer/src/lib/stt-tts-harness-config.ts` (new), `SettingsPage.tsx`, `ChatPage.tsx`: the configuration surface and its projection into `session.config`.

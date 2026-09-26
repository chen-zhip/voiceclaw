# Validation evidence

## Automated desktop checks

- Desktop renderer suite: 49 files passed, 2 skipped; 300 tests passed, 2 skipped.
- Desktop typecheck passed.
- Desktop production build passed. The existing package module-type warning remained unchanged.
- Standards and specification review completed with no blocking findings after fixes. Coverage now includes returning to Chat after a saved mode change, voice-session presentation through connecting/active/reconnecting/termination, typed-input mode capture, persistence handoff without a blank gap, and cleanup after normal end or exhausted reconnects.

## Real voice-provider acceptance

- Loaded the operator-supplied PowerShell environment assignments without printing their values.
- Confirmed the configured GPT-SoVITS installation, Python runtime, reference audio, and shipped Harness plugin roots exist.
- Started the configured local GPT-SoVITS API and ran `relay-server/test/integration/gpt-sovits-real.test.ts`.
- The provider boundary synthesized non-empty speech and FunASR returned a non-empty transcript with no provider errors.

## Electron acceptance

- Started the real Electron app with the configured GPT-SoVITS and Codex Harness environment.
- Confirmed STT/TTS Harness mode, `gpt-sovits-stt`, `gpt-sovits-tts`, and the Codex binding were selected.
- Confirmed historical and error assistant entries render as full-width accessible `AI output` regions without assistant bubble chrome; user entries remain right-aligned bubbles.
- Confirmed dark and light themes, settings navigation and return, narrow layout, long/multiline content, attachments, multiple turns, and the jump-to-latest control remain usable without horizontal overflow.
- Started and ended a real STT/TTS session. Typed input was accepted during the active session and retained its typed provenance.
- Exercised microphone mute/unmute, agent-audio mute/unmute, and the output-volume slider from 100% to 42% and back to 100%.
- The saved xAI realtime model still reports its pre-existing missing-key error for an idle typed turn. The configured local TTS/STT provider loop and active Harness transport were validated independently of that unrelated credential state.

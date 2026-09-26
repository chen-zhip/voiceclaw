## Why

The STT/TTS Harness path currently only reaches cloud voice services (Deepgram STT, ElevenLabs TTS), so a local, self-hosted voice stack cannot be selected. A GPT-SoVITS checkout already lives at the repository root (`GPT-SoVITS-v2pro-nvidia50/`) and provides both halves of the loop: an HTTP TTS API (`api_v2.py`) and offline ASR (`tools/asr/funasr_asr.py`). Delivering both through one first-party voice provider makes the whole voice loop runnable without cloud credentials.

## What Changes

- Add two separately registered first-party Relay voice providers backed by the same local GPT-SoVITS installation: the id `gpt-sovits-tts` implementing the `TTSProvider` boundary and the id `gpt-sovits-stt` implementing the `STTProvider` boundary, each selected independently through the existing provider factories and session configuration.
- Implement TTS by calling the local GPT-SoVITS HTTP API (`POST /tts`, api_v2 request shape) with session-configured reference audio, language, and synthesis parameters, returning client-ready PCM16 base64 audio chunks.
- Implement STT by endpointing the streamed PCM16 input inside the recognition provider, writing each utterance as a 16 kHz mono WAV, and invoking the GPT-SoVITS offline ASR CLI (`tools/asr/funasr_asr.py`) to produce one final transcript per utterance.
- State the resulting STT behavior explicitly: the offline ASR path produces no interim hypotheses, so partial transcripts are never emitted for this provider.
- Fail closed with an actionable, provider-neutral error when configuration, the local runtime, the TTS service, or the ASR invocation is unavailable; never silently fall back to another voice provider.
- Record the local GPT-SoVITS capability baseline (TTS request fields, ASR CLI arguments, required model assets) and require a deliberate, reviewed update when that baseline no longer matches.
- Keep the local GPT-SoVITS checkout out of version control: it is currently untracked and not ignored, and the plugin references it only through configuration at runtime.
- Out of scope: streaming GPT-SoVITS synthesis, model download or Python environment provisioning, supervising the GPT-SoVITS service, changing Desktop audio capture/playback, and automatic voice-provider ordering or fallback.

## Capabilities

### New Capabilities

- `voice/gpt-sovits`: one local GPT-SoVITS voice provider component supplying both TTS and STT for the STT/TTS Harness path, including its configuration, readiness, failure behavior, and capability baseline.

### Modified Capabilities

None. `voice/stt-tts-mode` already specifies provider-neutral STT/TTS provider selection, configuration, and failure reporting; this change adds a provider without changing those requirements.

## Impact

- `relay-server/src/tts/*` and `relay-server/src/stt/*`: two separate provider implementations plus their own factory registrations; the ids `gpt-sovits-tts` and `gpt-sovits-stt` become independently selectable through `session.config`.
- `relay-server/src/types.ts` / `session.ts`: the existing per-provider configuration mapping extends to `gpt-sovits`.
- New local runtime prerequisite: a GPT-SoVITS checkout (TTS service reachable over HTTP; offline ASR runnable through a configured Python) — supplied by the operator, not installed by VoiceClaw.
- Existing cloud providers, the S2S paths, the Harness Execution Routing contract, and the Kernel/Plugin model are unchanged. Migrating voice providers onto Feature Plugin packages stays with `complete-harness-provider-integrations`.
- Acceptance needs both deterministic provider-boundary tests and an opt-in real GPT-SoVITS run; the physical Desktop journey remains owned by `integrate-codex-provider-prototype`.

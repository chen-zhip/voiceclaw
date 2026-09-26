## Context

See `proposal.md` and `specs/voice/gpt-sovits/spec.md`. Relay selects voice components by id through `createSTTProvider` / `createTTSProvider`, and `session.config` carries `sttProvider`, `ttsProvider`, `sttConfig`, and `ttsConfig`; each boundary is a narrow interface (`TTSProvider.synthesize` streams audio chunks, `STTProvider.processAudio` accepts base64 PCM16 with `commit` and partial/final callbacks). Cloud providers read their credential from the session config with an environment fallback.

The local installation at `GPT-SoVITS-v2pro-nvidia50/` supplies both halves:

- Synthesis: FastAPI service (`api_v2.py`) exposing `POST /tts` (also `GET /tts`), `GET /control`, `GET /set_refer_audio`, `GET /set_gpt_weights`, `GET /set_sovits_weights`. The accepted request body is the `TTS_Request` model: `text`, `text_lang`, `ref_audio_path`, `aux_ref_audio_paths`, `prompt_lang`, `prompt_text`, `top_k`, `top_p`, `temperature`, `text_split_method`, `batch_size`, `batch_threshold`, `split_bucket`, `speed_factor`, `fragment_interval`, `seed`, `media_type`, `streaming_mode`, `parallel_infer`, `repetition_penalty`, `sample_steps`, `super_sampling`, `overlap_length`, `min_chunk_length`.
- Recognition: an offline CLI (`tools/asr/funasr_asr.py`) with `-i/--input_folder`, `-o/--output_folder`, `-s/--model_size`, `-l/--language` (`zh` | `yue` | `auto`), `-p/--precision`, reading the local FunASR models from `tools/asr/models/`.

That checkout is currently untracked and not covered by `.gitignore`. Fixed comparison point for the final `$code-review`: `2264f0af6186abd25cf8185d635cf049f6ad3239`.

## Goals / Non-Goals

**Goals:** two independently selectable local providers — synthesis and recognition — backed by one local installation; synthesis through the local HTTP API; recognition through the bundled offline ASR while still satisfying the streaming STT interface; explicit, actionable failure behavior; a recorded capability baseline instead of runtime guessing.

**Non-Goals:** streaming synthesis, streaming/interim recognition, service supervision or model provisioning, changing Desktop capture/playback, provider ordering or automatic fallback, and migrating voice providers onto Feature Plugin packages.

## Decisions

### Two providers, one local installation, still factory-registered

The change adds two separate provider implementations: `gpt-sovits-tts` satisfies only the TTS boundary through the local HTTP API, and `gpt-sovits-stt` satisfies only the STT boundary through the bundled offline ASR. They share one local GPT-SoVITS installation and a small internal module for configuration resolution and the capability baseline record — they do NOT share a component id, a lifecycle, or a readiness state. The boundaries have genuinely different transports (one HTTP request per speech unit versus one offline CLI invocation per utterance), different configuration, and different failure and availability semantics; a half-available installation then degrades exactly one boundary instead of one component that can be neither trusted nor replaced. It also lets a session pair the local synthesis provider with any other registered recognition provider and the other way round. Alternatives: one id serving both boundaries (rejected — the explicitly requested shape, and it couples two unrelated failure modes), or wrapping each provider as a `voiceclaw.plugin.json` package (rejected for now — Phase 0 accepts only `desktop-service`, `provider-integration`, and `client-ui` contributions and has no Relay voice-provider type; that migration belongs to `complete-harness-provider-integrations`).

Both providers stay factory-registered (`createTTSProvider` for `gpt-sovits-tts`, `createSTTProvider` for `gpt-sovits-stt`). Terminology stays as the existing domain language: **STT Provider** and **TTS Provider** remain the domain nouns, and no new domain noun is introduced.

### Synthesis is one HTTP request per speech unit

The TTS adapter sends `POST /tts` with a deliberate subset of `TTS_Request` — `text`, `text_lang`, `ref_audio_path`, `prompt_text`, `prompt_lang`, `media_type: "wav"`, `speed_factor` — and forwards remaining synthesis parameters only when the session configures them. `streaming_mode` stays disabled for this change. The WAV response is decoded, resampled to the requested client sample rate, and emitted as PCM16 base64 chunks. `stop()` aborts the in-flight request; `getPlaybackPosition()` reports only submitted-text progress. Alternative: enabling `streaming_mode` (rejected for now — it changes the response framing and the abort semantics, and is a separable follow-up).

### Recognition endpoints inside the provider, then calls offline ASR per utterance

The STT adapter keeps a PCM16 buffer and splits utterances on silence using the existing `endpointingMs` semantics; on utterance end (or on `commit`) it writes a 16 kHz mono WAV into a temporary directory and invokes `<python> <gpt-sovits>/tools/asr/funasr_asr.py -i <dir> -o <dir> -s large -l <language>`, then emits the produced text as the final transcript. Because this path has no interim output, no partial transcript is ever emitted for this provider. Alternative: require a streaming ASR service (rejected — the checkout ships offline ASR only); alternative: push segmentation to the client (rejected — it would change the shared STT contract for one provider).

### Configuration comes from session config with environment fallback

The provider needs the GPT-SoVITS root path, the synthesis service address, the runtime that executes ASR, the recognition language, the reference audio plus its prompt text, and optional synthesis parameters. These arrive through the per-provider wire configuration with environment fallbacks, matching how the existing providers resolve credentials; secrets stay out of the session projection. Missing required values fail at connect with actionable guidance.

### Capability baseline is recorded, not probed

The baseline record lists the synthesis request fields, the ASR invocation arguments, and the required local model assets the provider depends on. Readiness compares the configured installation against that record (`GET /control` reachable for synthesis; ASR script, runtime, and required model assets present for recognition) and fails closed with a persistent, visible mismatch warning when anything recorded is unavailable. Alternative: infer capabilities dynamically (rejected — ADR-0003 keeps Harness capability profiles static and warns instead of inventing support).

### Failure taxonomy maps onto the existing provider surface

Failures are surfaced in the classes configuration, runtime/executable, service-unavailable, synthesis-failed, recognition-failed, recognition-timeout, and decode-failed, each with actionable guidance and without switching providers. A single failed utterance does not take the recognition provider out of service for later utterances.

### Testability seams

Both factories accept an optional dependency object (synthesis HTTP boundary, ASR runner boundary, temp-directory boundary) mirroring `AdapterFactoryDependencies`, so provider behavior is tested at the `TTSProvider` / `STTProvider` seams plus the factory registration seam.

### The local installation stays outside the repository

The plugin references the checkout only through configuration, and the checkout is excluded from version control as part of this change; no product workspace imports it at build time.

## Risks / Trade-offs

- [Offline ASR adds per-utterance latency] → Recognition runs per finalized utterance, keeps partials absent by design, and reports timeout as an actionable failure rather than blocking the session.
- [The untracked 5 GB-scale checkout can be committed accidentally] → Exclude it from version control in this change and reference it only by configuration.
- [Spawning a Python CLI per utterance is heavier than a socket] → Keep the runner boundary injectable so an HTTP ASR service can replace it later without changing specs.
- [Local API shape varies across GPT-SoVITS revisions] → Record the capability baseline, fail closed on mismatch, and require a deliberate reviewed update.
- [Two providers duplicate configuration plumbing] → Share only configuration resolution and the baseline record through one internal module; keep transports, readiness, and failure handling separate per boundary.
- [Resampling can distort audio] → Resample only from the service's output rate to the requested client rate, and state the requested rate explicitly in the session configuration.
- [A misconfigured local service can fail mid-session] → Report synthesis failure for the affected speech unit and keep text output flowing, matching the existing provider-failure requirement.

## Migration Plan

1. Add the baseline record and the two provider implementations behind their own factory registrations; cloud providers remain the default selection.
2. Extend the session configuration mapping so `gpt-sovits-tts` and `gpt-sovits-stt` resolve their local settings independently without disturbing existing providers.
3. Exclude the local checkout from version control; document the operator-supplied runtime prerequisite.
4. Roll back by selecting the previous provider ids (or unsetting the new configuration); no data migration and no kernel change is involved.

## Open Questions

- Whether the offline ASR step should later be replaced by a streaming service is deferred; the runner boundary is injectable, so it changes implementation without changing the specs.
- Exact default synthesis parameters (reference audio, prompt text, speed) are operator choices; the provider ships defaults only where the local API defines one.

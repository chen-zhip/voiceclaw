## Context

See `proposal.md`. `createAdapter` resolves STT, Harness, and TTS through `requireComponentId` (`relay-server/src/adapters/index.ts:84`), which throws `… is required when mode is stt-tts` when the client omits a component. Desktop's `resolveHarnessSelection()` sends only `mode` and `harnessBinding`, nothing in Settings writes the missing three values, and the bundled Relay's `FORWARDED_KEYS` lacks the cloud credentials. The previous change made the local stack accept the Codex Contribution and report binding readiness, so only this configuration surface is missing.

Fixed comparison point for the final `$code-review`: `2264f0af6186abd25cf8185d635cf049f6ad3239`.

## Goals / Non-Goals

**Goals:** a locally bundled stack can start an STT/TTS Harness session with declared components; the same selection works once the UI writes it; every missing value produces an actionable message; provider failure stays visible.

**Non-Goals:** a provider picker beyond three text settings, capability discovery, non-Codex Harnesses, credential entry UI, and any change to Harness execution or routing contracts.

## Decisions

### Resolution order is client, then local declaration, then the existing error

`createAdapter` keeps `requireComponentId`'s error text and its call order, but each lookup becomes client value → environment declaration → the existing `… is required when mode is stt-tts` error. The Relay never invents a provider, and it never picks a locally hosted one: `gpt-sovits-stt` / `gpt-sovits-tts` must be named explicitly by the client or the declaration, because starting a local model service is never a safe assumption. The **bundled local stack** declares the cloud defaults (`deepgram`, `elevenlabs`) to its own Relay when the operator has not declared a provider, so a local install works out of the box without hard-coding a provider inside Relay. Alternatives: hard-coding cloud defaults inside `createAdapter` (rejected — it would hide a missing component from every other client), or defaulting to the local providers (rejected — a GPU service is never a safe implicit default).

### The environment is the Relay's declaration surface

`VOICECLAW_STT_PROVIDER`, `VOICECLAW_TTS_PROVIDER`, and `VOICECLAW_HARNESS_ID` form the local stack's declaration, mirroring how `VOICECLAW_HARNESS_PACKAGE_ID` already selects the Harness provider package. Desktop forwards them (plus `DEEPGRAM_API_KEY` / `ELEVENLABS_API_KEY`) so the bundled Relay behaves like a standalone one. Alternatives: a control-state record (rejected — this is selection, not authority), or Desktop injecting values into every `session.config` (rejected — it hides the real configuration surface the UI will own).

### The Harness id is its own setting

`harness_id` is stored and read independently of `harness_provider_id`; today both happen to be `codex`, and deriving one from the other would encode that coincidence into the client.

### Selection logic lives in one testable module

`desktop/src/renderer/src/lib/stt-tts-harness-config.ts` owns the six-field assembly (`provider`, `workspace`, `binding`, `sttProvider`, `ttsProvider`, `harness`) and the per-field missing messages; `resolveHarnessSelection()` becomes a thin reader of settings. This keeps the renderer wiring trivial and the messages unit-testable without a DOM.

### Failure stays fail-closed and visible

Nothing in this change adds a fallback between providers: an unavailable selected provider or Harness reports its own failure. A TTS synthesis failure leaves public screen text readable and sends an actionable failure event to the client.

## Risks / Trade-offs

- [Environment fallback could mask a UI bug] → Client-supplied values always win, and the missing-value messages name the exact field so a UI regression is visible in the error.
- [Forwarding cloud credentials widens the Relay child's environment] → Only the two provider keys are added, matching their existing use in `session.config`; nothing else is forwarded.
- [Adding `voiceMode: 'direct'` removal changes client behavior] → The field is only meaningful to S2S paths; the Harness path never read it, and the change is covered by a unit test asserting the assembled config omits it.
- [Settings keys are free text] → Validation stays on the Relay side (`Unknown STT provider …`), so a typo fails closed with the existing message.

## Migration Plan

1. Land the Relay fallback and the forwarding allow-list; existing sessions that name their components are unaffected.
2. Add the Settings keys and the config module; `resolveHarnessSelection()` reads them.
3. Roll back by clearing the environment variables: the Relay then behaves exactly as it does today.

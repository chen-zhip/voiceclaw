# Select the STT/TTS Harness Conversation Pipeline

Existing clients remain on an S2S Conversation Pipeline. An absent or invalid `mode` resolves to `"s2s"`; within that branch, an absent, invalid, or `"direct"` `voiceMode` selects S2S Direct, `"operator"` selects S2S Operator, and the accepted `"supervisor"` scaffold currently executes S2S Direct behavior. No migration is required until a client explicitly selects STT/TTS Harness.

## Before: S2S Direct

```json
{
  "type": "session.config",
  "provider": "openai",
  "voice": "marin",
  "brainAgent": "none",
  "apiKey": "relay-api-key"
}
```

## After: STT/TTS Harness

Keep the existing compatibility fields and select the STT/TTS Harness Conversation Pipeline:

```json
{
  "type": "session.config",
  "mode": "stt-tts",
  "provider": "openai",
  "voice": "marin",
  "brainAgent": "none",
  "apiKey": "relay-api-key",
  "sttProvider": "deepgram",
  "harness": "claude-code",
  "harnessConfig": {
    "gatewayUrl": "http://127.0.0.1:4319"
  },
  "ttsProvider": "elevenlabs",
  "ttsConfig": {
    "sentenceBatchSize": 1
  }
}
```

Set `DEEPGRAM_API_KEY` and `ELEVENLABS_API_KEY` on Relay, or pass the keys in `sttConfig.apiKey` and `ttsConfig.apiKey`. The stable `claude-code`, `codex`, and `cherry-studio` Harness IDs are unavailable by default in this scaffold; deterministic tests provide injected boundaries. The first production path is planned by Kernel Phase 0, Desktop Host, Routing, and `integrate-codex-provider-prototype`; `complete-harness-provider-integrations` later adds further Providers and parity.

To return to S2S Direct, remove `mode` and the STT/Harness/TTS fields and omit `voiceMode` or set it to `"direct"`. To select S2S Operator, use `mode: "s2s"` with `voiceMode: "operator"`. Relay does not automatically replay the failed input or change Conversation Pipelines.

## Sentence batching

`ttsConfig.sentenceBatchSize` defaults to `1`. Values from `1` to `3` are typical: `1` minimizes time to first audio, while `2` or `3` gives the synthesizer more cross-sentence context for prosody. The relay clamps every value to the hard cap of `5`; larger batches trade more latency for longer-context delivery and are not recommended for interactive turns.

# Migrate from S2S to STT/TTS mode

Existing clients remain in speech-to-speech mode. An absent or invalid `mode` resolves to `"s2s"`, so no migration is required until a client explicitly opts in.

## Before: S2S

```json
{
  "type": "session.config",
  "provider": "openai",
  "voice": "marin",
  "brainAgent": "none",
  "apiKey": "relay-api-key"
}
```

## After: composed STT/TTS

Keep the existing compatibility fields and add the composed-mode selectors:

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

Set `DEEPGRAM_API_KEY` and `ELEVENLABS_API_KEY` on the relay, or pass the keys in `sttConfig.apiKey` and `ttsConfig.apiKey`. Verify the Harness gateway before switching production clients: `claude-code` is available, while `codex` and `cherry-studio` are reserved but unavailable in this build.

To roll back, remove `mode` and the STT/Harness/TTS fields. The original provider path is unchanged.

## Sentence batching

`ttsConfig.sentenceBatchSize` defaults to `1`. Values from `1` to `3` are typical: `1` minimizes time to first audio, while `2` or `3` gives the synthesizer more cross-sentence context for prosody. The relay clamps every value to the hard cap of `5`; larger batches trade more latency for longer-context delivery and are not recommended for interactive turns.

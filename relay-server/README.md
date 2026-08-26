# VoiceClaw Relay Server

WebSocket relay that bridges mobile clients to the OpenAI Realtime API and the brain agent gateway.

## Setup

1. Copy `.env.example` to `.env` and fill in your keys
2. Point `BRAIN_GATEWAY_URL` at any OpenAI-compatible chat completions endpoint (required for brain agent).
   If you use [OpenClaw](https://github.com/yagudaev/openclaw), enable the gateway completions endpoint:
   - In `~/.openclaw/openclaw.json`, add under the `gateway` key:
     ```json
     "http": {
       "endpoints": {
         "chatCompletions": { "enabled": true }
       }
     }
     ```
   - Restart the gateway
3. `yarn install && yarn dev`

## Architecture

```
Mobile App ──WebSocket──▶ Relay Server ──WebSocket──▶ OpenAI Realtime API
                              │
                              └──HTTP──▶ Brain Agent Gateway (/v1/chat/completions)
                                         (any OpenAI-compatible endpoint)
```

The relay handles:

- OpenAI Realtime session management and rotation (50 min cycles)
- Server-side tool execution (brain agent)
- Watchdog for stale connections
- Audio passthrough (PCM16 24kHz)

## STT/TTS sessions

STT/TTS mode composes Deepgram recognition, a Harness adapter, and ElevenLabs
speech synthesis. Send this configuration as the first authenticated WebSocket
message:

```json
{
  "type": "session.config",
  "mode": "stt-tts",
  "provider": "openai",
  "voice": "test",
  "brainAgent": "none",
  "apiKey": "relay-api-key",
  "sttProvider": "deepgram",
  "sttConfig": {
    "apiKey": "deepgram-api-key",
    "model": "nova-3",
    "endpointingMs": 300
  },
  "harness": "claude-code",
  "harnessConfig": {
    "gatewayUrl": "http://127.0.0.1:4319",
    "authToken": "harness-token"
  },
  "ttsProvider": "elevenlabs",
  "ttsConfig": {
    "apiKey": "elevenlabs-api-key",
    "voice": "21m00Tcm4TlvDq8ikWAM",
    "sentenceBatchSize": 1
  }
}
```

`provider`, `voice`, `brainAgent`, and `apiKey` remain required wire fields for
backward compatibility. In STT/TTS mode, `sttProvider`, `harness`, and
`ttsProvider` are also required. Provider API keys may instead be supplied as
`DEEPGRAM_API_KEY` and `ELEVENLABS_API_KEY` in the relay environment.

### Provider contracts

| Port             | Required behavior                                                                                             | Current implementation and configuration                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `STTProvider`    | Connect, accept base64 PCM16, emit partial/final transcripts, commit, report errors, disconnect               | `deepgram`; `apiKey`, `model` (default `nova-3`), `language` (default `en-US`), `sampleRate` (default 16000), `endpointingMs` (default 300) |
| `HarnessAdapter` | Declare capabilities, connect, stream `OutputChunk` values, disconnect; interruption and overlay are optional | `claude-code`; `gatewayUrl`, optional `authToken`, `timeoutMs` (default 120000), session instructions                                       |
| `TTSProvider`    | Connect, stream base64 PCM16, report playback position, stop, disconnect                                      | `elevenlabs`; `apiKey`, `voice`, `model` (default `eleven_turbo_v2_5`), supported PCM `sampleRate`, `speed`                                 |

Provider and Harness IDs are validated before any component is constructed. Missing keys produce actionable configuration errors. STT failures preserve buffered input for retry, Harness failures suggest S2S fallback, and TTS failures retain text output and end the turn normally.

### Sentence batching

`ttsConfig.sentenceBatchSize` defaults to `1`; values from `1` to `3` are typical and the hard cap is `5`. A batch of `1` starts synthesis at the first complete sentence for lower latency. Larger batches give TTS more cross-sentence context and can improve prosody, but delay the first audio sample.

For migration and rollback examples, see `docs/stt-tts-migration.md`. Harness capability and registry details are in `docs/harness-integration.md`.

## Thinking capture (optional)

Thinking capture is disabled by default. It writes no reasoning data unless
`VOICECLAW_THINKING_CAPTURE` is set to the exact value `enabled`.

When enabled, entries are appended as JSONL under
`~/.voiceclaw/thinking/<sessionId>.jsonl`. Set `VOICECLAW_THINKING_DIR` to use a
custom directory. Thinking content stays server-side; client notifications
contain paths only.

Authenticated clients can remove one session's capture with
`{"type":"thinking.delete","sessionId":"<sessionId>"}` or remove all local
thinking captures with `{"type":"thinking.wipe"}`. These operations do not
send thinking content back to the client.

## Tracing (optional)

The relay can emit per-turn traces to [Langfuse](https://langfuse.com) so you
can measure latency, inspect prompts/responses, and attribute token/audio
cost per voice turn.

Tracing is **off by default**. Set the keys in `.env` to enable:

```
LANGFUSE_BASE_URL=https://us.cloud.langfuse.com   # or EU / self-hosted
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
```

When configured, each WebSocket connection maps to a Langfuse **session**
and each voice turn is a **generation** span. Server-side tool calls
(e.g. `ask_brain`) nest as tool spans; they may span multiple turns
since async tools typically resolve on the next turn.

Mobile devices can also post latency measurements via `client.timing`
events (e.g. `ttft_audio`, turn.started → first TTS byte). Mobile
emission is on by default in dev builds (`__DEV__`) and off in release
builds unless `EXPO_PUBLIC_ENABLE_TRACING=1` is set at build time.

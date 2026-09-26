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

## STT/TTS Harness sessions

STT/TTS Harness is currently a Relay-side Conversation Pipeline scaffold for
Deepgram recognition, a Harness Integration Contract boundary, and ElevenLabs speech synthesis. Deterministic
tests use injected boundary fakes; this change does not include a runnable
Harness Provider, Desktop or Mobile entry point, or production Provider
integration. That work belongs to
[`complete-harness-provider-integrations`](../openspec/changes/complete-harness-provider-integrations/proposal.md).

The scaffold accepts this configuration shape as the first authenticated
WebSocket message once a runnable Harness boundary is supplied:

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
backward compatibility. In the STT/TTS Harness Conversation Pipeline, `sttProvider`, `harness`, and
`ttsProvider` are also required. Provider API keys may instead be supplied as
`DEEPGRAM_API_KEY` and `ELEVENLABS_API_KEY` in the relay environment.

### Provider contracts

| Port                                                                   | Required behavior                                                                                             | Current implementation and configuration                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `STTProvider`                                                          | Connect, accept base64 PCM16, emit partial/final transcripts, commit, report errors, disconnect               | `deepgram`; `apiKey`, `model` (default `nova-3`), `language` (default `en-US`), `sampleRate` (default 16000), `endpointingMs` (default 300) |
| Harness Integration Contract (`HarnessAdapter` in the legacy scaffold) | Declare capabilities, connect, stream `OutputChunk` values, disconnect; interruption and overlay are optional | `claude-code`; `gatewayUrl`, optional `authToken`, `timeoutMs` (default 120000), session instructions                                       |
| `TTSProvider`                                                          | Connect, stream base64 PCM16, report playback position, stop, disconnect                                      | `elevenlabs`; `apiKey`, `voice`, `model` (default `eleven_turbo_v2_5`), supported PCM `sampleRate`, `speed`                                 |

Provider and Harness IDs are validated before any component is constructed. Missing keys produce actionable configuration errors. STT failures preserve buffered input for explicit resubmission. Harness failures provide Recovery Guidance for resubmitting input or explicitly selecting S2S Direct (`mode: "s2s"`, `voiceMode: "direct"`) or S2S Operator (`mode: "s2s"`, `voiceMode: "operator"`); Relay does not automatically retry, replay, or switch Conversation Pipelines. TTS failures retain text output and end the turn normally.

### Sentence batching

`ttsConfig.sentenceBatchSize` defaults to `1`; values from `1` to `3` are typical and the hard cap is `5`. A batch of `1` starts synthesis at the first complete sentence for lower latency. Larger batches give TTS more cross-sentence context and can improve prosody, but delay the first audio sample.

For migration and rollback examples, see `docs/stt-tts-migration.md`. Harness capability and registry details are in `docs/harness-integration.md`.

### STT/TTS debug output

STT/TTS debug output is off by default. Set `VOICECLAW_STT_TTS_DEBUG=true`
before starting a standalone Relay to emit one-line JSON diagnostic records. A
Desktop-launched bundled Relay receives the same environment setting and writes
the records to the existing `relay-server.log` service log.

This mode records pipeline stages, provider and turn correlation, timings,
aggregate audio byte/chunk counts, the complete finalized STT transcript, and
the complete text submitted for TTS synthesis. Those text fields may contain
sensitive user content, so enable the mode only while actively diagnosing a
local run and protect the resulting log accordingly.

Debug output never includes microphone or synthesized audio/base64, credentials,
tokens, bootstrap secrets, unrestricted component configuration, or private
Provider reasoning. Disable and roll back the diagnostic mode by removing
`VOICECLAW_STT_TTS_DEBUG` (or setting it to any value other than the exact
lowercase string `true`) and restarting the Relay.

For the full checkpoint catalog, record fields, expected flow, and
missing-checkpoint troubleshooting guide, see
[`docs/stt-tts-debug-checkpoints.md`](../docs/stt-tts-debug-checkpoints.md).

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

Traces contain only thinking presence, size, private classification, and local
capture status by default. Exporting thinking steps and reasoning is a separate
diagnostic permission: both `VOICECLAW_THINKING_CAPTURE=enabled` and
`VOICECLAW_TRACE_CONTENT=enabled` are required. Before export, exact non-empty
`apiKey`, `authToken`, and `token` values from the active STT, Harness, and TTS
configuration are replaced with `[REDACTED]`. Enabling local capture alone does
not authorize trace-content export.

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

## Local GPT-SoVITS voice providers

An STT/TTS session can select local, self-hosted voice capability instead of the
cloud providers:

| Boundary    | `sttProvider` / `ttsProvider` value | Runtime it needs                                                            |
| ----------- | ----------------------------------- | --------------------------------------------------------------------------- |
| Synthesis   | `gpt-sovits-tts`                    | A running GPT-SoVITS API service (`api_v2.py`, `POST /tts`)                 |
| Recognition | `gpt-sovits-stt`                    | A GPT-SoVITS checkout whose offline ASR (`tools/asr/funasr_asr.py`) can run |

Each id answers only its own boundary, so a session may pair one local provider
with a cloud provider on the other side. Neither id falls back to another
provider: a missing runtime or a capability-baseline mismatch fails that
boundary closed with an actionable message.

VoiceClaw never installs, launches, or version-controls GPT-SoVITS. The operator
supplies the installation, and the relay reads these settings from the
environment, falling back to per-session `sttConfig` / `ttsConfig` fields when a
trusted client sends them:

| Setting                | Environment variable                               | Required for     |
| ---------------------- | -------------------------------------------------- | ---------------- |
| Service URL            | `GPT_SOVITS_SERVICE_URL`                           | `gpt-sovits-tts` |
| Reference audio path   | `GPT_SOVITS_REFERENCE_AUDIO`                       | `gpt-sovits-tts` |
| Target language        | `GPT_SOVITS_TEXT_LANG`                             | `gpt-sovits-tts` |
| Prompt text / language | `GPT_SOVITS_PROMPT_TEXT`, `GPT_SOVITS_PROMPT_LANG` | optional         |
| Installation root      | `GPT_SOVITS_ROOT`                                  | `gpt-sovits-stt` |
| Python executable      | `GPT_SOVITS_PYTHON` (default `python`)             | `gpt-sovits-stt` |
| Recognition language   | `GPT_SOVITS_ASR_LANGUAGE` (default `zh`)           | optional         |

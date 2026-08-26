# Harness integration

The relay uses `HarnessAdapter` as the stable boundary between recognized user text and streamed assistant output. An adapter declares these capabilities before a turn starts:

| Capability         | Meaning                                                                    | Degradation when unavailable                                  |
| ------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `structuredOutput` | Separates thinking, speech, and text; `"partial"` allows only some streams | Plain or invalid output becomes both speech and readable text |
| `streaming`        | Produces incremental `OutputChunk` values                                  | A complete response is routed when it arrives                 |
| `interruption`     | Can resume an active stream with interruption context                      | The relay cancels and restarts the last request               |
| `overlay`          | Can answer a side query without disturbing the main stream                 | The overlay returns empty after its bounded fallback          |

## Stable registry IDs

| ID              | Availability            | Notes                                                            |
| --------------- | ----------------------- | ---------------------------------------------------------------- |
| `claude-code`   | Available               | Connects through the configured HTTP Harness gateway             |
| `codex`         | Unavailable placeholder | Reserved stable ID; implementation is not included in this build |
| `cherry-studio` | Unavailable placeholder | Reserved stable ID; implementation is not included in this build |

Use the IDs exactly as shown in `session.config.harness`. Unknown IDs fail before provider construction and report all known IDs. Known but unavailable adapters fail before connection, report the currently available IDs, and leave S2S mode as an actionable fallback.

## Claude Code configuration

```json
{
  "harness": "claude-code",
  "harnessConfig": {
    "gatewayUrl": "http://127.0.0.1:4319",
    "authToken": "optional-bearer-token",
    "timeoutMs": 120000
  }
}
```

The gateway must expose `POST /v1/chat/completions`. The adapter injects the structured-output contract and accepts SSE or a complete response body. Authentication rejection, timeout, and connectivity errors become actionable Harness errors; they do not silently select a different adapter.

Streaming structured adapters must emit `speech.emotion`, `speech.speed`, and
`speech.screenReferences` before `speech.content`, with `content` last in the
speech object. This lets the relay begin sentence synthesis immediately while
applying prosody and highlight metadata to the same audio. Late metadata is
handled as a degradation path but cannot retroactively change audio already
synthesized.

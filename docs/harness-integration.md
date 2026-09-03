# Harness Integration Contract scaffold

Relay uses the Harness Integration Contract as the boundary between recognized user text and streamed assistant output. `HarnessAdapter` is the legacy code identifier for the current Relay scaffold, which is exercised with injected boundary fakes; it is not a production Claude Code, Codex, or Cherry Studio runtime. Production runtimes, Desktop Host supervision, and VoiceClaw Integration Plugins belong to [`complete-harness-provider-integrations`](../openspec/changes/complete-harness-provider-integrations/proposal.md).

An adapter statically declares these scaffold capabilities before a turn starts. A declaration is a routing hint and does not prove runtime availability:

| Capability         | Meaning                                                                    | Degradation when unavailable                                                             |
| ------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `structuredOutput` | Separates thinking, speech, and text; `"partial"` allows only some streams | Plain or invalid output becomes both speech and readable text                            |
| `streaming`        | Produces incremental `OutputChunk` values                                  | A complete response is routed when it arrives                                            |
| `interruption`     | Can resume an active stream with interruption context                      | Relay cancels the active stream and provides Recovery Guidance for explicit resubmission |
| `overlay`          | Can answer a side query without disturbing the main stream                 | The overlay returns empty after its bounded fallback                                     |

## Stable registry IDs

| ID              | Default availability | Notes                                                                  |
| --------------- | -------------------- | ---------------------------------------------------------------------- |
| `claude-code`   | Unavailable          | HTTP gateway scaffold supports dependency-injected boundary tests only |
| `codex`         | Unavailable          | Reserved stable ID; no runnable Provider is included                   |
| `cherry-studio` | Unavailable          | Reserved stable ID; no runnable Provider is included                   |

Use the IDs exactly as shown in `session.config.harness`. Unknown IDs fail before Provider construction and report all known IDs. Known but unavailable boundaries fail before connection and report the currently available IDs. Recovery Guidance explains how to resubmit input or explicitly select S2S Direct (`mode: "s2s"`, `voiceMode: "direct"`) or S2S Operator (`mode: "s2s"`, `voiceMode: "operator"`); it is not an executable retry or automatic Pipeline switch.

## HTTP gateway scaffold configuration

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

An injected test boundary may expose `POST /v1/chat/completions`. The adapter injects the structured-output contract and accepts SSE or a complete response body. This request shape is a VoiceClaw gateway scaffold, not a Provider-native API or startup contract. Authentication rejection, timeout, and connectivity errors identify the configured gateway; they do not recommend unverified Provider commands or silently select a different adapter.

Streaming structured adapters must emit `speech.emotion`, `speech.speed`, and
`speech.screenReferences` before `speech.content`, with `content` last in the
speech object. This lets the relay begin sentence synthesis immediately while
applying prosody and highlight metadata to the same audio. Late metadata is
handled as a degradation path but cannot retroactively change audio already
synthesized.

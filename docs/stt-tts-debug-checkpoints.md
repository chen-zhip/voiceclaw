# STT/TTS Debug Checkpoints

This reference describes the operator-visible checkpoints emitted by the
STT/TTS Harness Conversation Pipeline. They are intended to locate a stalled or
failed stage without recording binary media, credentials, configuration
objects, or private Provider reasoning.

## Enable and disable

Debug output is disabled by default and activates only when the environment
value is the exact lowercase string `true`:

```powershell
$env:VOICECLAW_STT_TTS_DEBUG = 'true'
yarn dev:server
```

For the Desktop-managed stack, set the variable before starting Desktop. The
Desktop App forwards it to the bundled Relay, whose output is written to the
existing `relay-server.log` service log. A standalone Relay writes the same
records to its normal stdout log stream.

Restart Relay after changing the value. Disable the mode by removing the
variable or assigning any value other than `true`:

```powershell
Remove-Item Env:\VOICECLAW_STT_TTS_DEBUG -ErrorAction SilentlyContinue
```

S2S Direct and S2S Operator sessions do not emit these checkpoints even when
the switch is enabled.

## Record format

Each checkpoint is one line containing the prefix `[stt-tts-debug]` followed by
a JSON object:

```text
[stt-tts-debug] {"marker":"stt-tts-debug","timestamp":"2026-09-13T02:03:18.551Z","event":"stt.recognition.complete","sessionId":"session-1","stage":"stt","providerId":"gpt-sovits-stt","turnId":"turn-1","inputBytes":32000,"sampleRate":16000,"endpointReason":"client-commit","durationMs":842,"transcriptText":"完整的识别文本","transcriptCharacters":7}
```

Every record contains `marker`, `timestamp`, and `event`. Other fields appear
only when the current boundary has an authoritative value:

| Field                                  | Meaning                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `stage`                                | `session`, `stt`, `harness`, or `tts`                                           |
| `sessionId`                            | Owning Relay Session correlation                                                |
| `turnId`                               | Client or authoritative Harness turn identity when allocated                    |
| `attemptId`                            | Harness Execution Attempt identity                                              |
| `providerId`                           | Selected provider participating at this checkpoint                              |
| `componentRole`                        | Component being connected: `stt`, `harness`, or `tts`                           |
| `durationMs`                           | Elapsed time measured at the named Relay boundary, not provider-internal timing |
| `error`, `reason`, `status`, `outcome` | Bounded failure, cancellation, rejection, or terminal detail                    |

## Checkpoint catalog

### Session and component connection

| Event                      | Emitted when                                                     | Important fields                           |
| -------------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| `session.connect.start`    | Relay begins connecting one selected component                   | `sessionId`, `componentRole`, `providerId` |
| `session.connect.complete` | That component connection resolves successfully                  | `sessionId`, `componentRole`, `providerId` |
| `session.connect.failed`   | STT/TTS connection rejects or Harness connection reports failure | connection fields, `error`                 |
| `session.disconnect`       | The composed STT/TTS adapter disconnects                         | `sessionId`, optional `turnId`             |

There is one start/outcome pair per STT, Harness, and TTS component. Connection
configuration values are never serialized.

### Speech recognition

| Event                       | Emitted when                                                                              | Important fields                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `stt.audio.commit`          | A client commit starts recognition, or the provider finalizes through its own endpointing | `endpointReason`, `inputBytes`, `sampleRate`, correlation                       |
| `stt.recognition.complete`  | STT supplies a final transcript                                                           | previous input metadata, `durationMs`, `transcriptText`, `transcriptCharacters` |
| `stt.recognition.failed`    | STT reports a recognition error                                                           | correlation, input metadata, `durationMs`, `error`                              |
| `stt.recognition.timeout`   | The configured final-transcript deadline expires                                          | correlation, `endpointReason`, input metadata, `durationMs`                     |
| `stt.recognition.cancelled` | User cancellation or session disconnect abandons pending recognition                      | correlation, input metadata, `durationMs`, `reason`                             |

`endpointReason` is `client-commit` when the Client explicitly commits audio and
`provider-finalized` when a Provider final transcript arrives without that
commit. `inputBytes` is the decoded aggregate byte count; microphone bytes and
their base64 source are never written.

### Harness execution

| Event                       | Emitted when                                                            | Important fields                                       |
| --------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| `harness.dispatch.start`    | Relay submits finalized recognized text to Harness routing              | `sessionId`, `providerId`                              |
| `harness.dispatch.queued`   | Another Harness turn is active and this input is queued                 | `turnId`, `durationMs`, correlation                    |
| `harness.dispatch.complete` | Routing returns an accepted Harness Execution Attempt                   | `turnId`, `attemptId`, `durationMs`, correlation       |
| `harness.speech.received`   | An accepted public speech event is routed                               | `turnId`, `attemptId`, `sequence`, `speechCharacters`  |
| `harness.stream.rejected`   | An event fails identity, sequence, terminal, or output-class validation | correlation, `sequence`, rejection code in `status`    |
| `harness.terminal`          | An accepted terminal event is projected                                 | correlation, `sequence`, `outcome`                     |
| `harness.failed`            | Initial dispatch or active stream processing throws                     | available correlation, `error`, sometimes `durationMs` |
| `harness.cancelled`         | An active cancellation is accepted                                      | correlation, `reason`                                  |

Harness checkpoint fields never include the raw execution payload. In
particular, private reasoning content is neither logged nor summarized.

### Speech synthesis and delivery

| Event                     | Emitted when                                             | Important fields                                      |
| ------------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| `tts.synthesis.start`     | A complete batched speech unit is submitted to TTS       | correlation, `synthesisText`, `synthesisCharacters`   |
| `tts.synthesis.complete`  | All audio chunks for that submission have been delivered | correlation, `durationMs`, `chunkCount`, `audioBytes` |
| `tts.synthesis.failed`    | Synthesis or iteration of its audio stream throws        | correlation, `durationMs`, `error`                    |
| `tts.synthesis.cancelled` | Speech delivery is aborted                               | available correlation, `reason`                       |

`synthesisText` contains the complete text submitted to TTS. `audioBytes` and
`chunkCount` are aggregates; synthesized bytes and base64 are never written.

## Expected checkpoint flow

A successful Host-routed turn normally contains these groups:

```text
session.connect.start / complete     (STT, Harness, TTS)
stt.audio.commit
stt.recognition.complete
harness.dispatch.start
harness.dispatch.complete
harness.speech.received              (one or more)
tts.synthesis.start / complete       (one or more sentence batches)
harness.terminal
```

Do not treat this list as a strict total order. Harness routing and queued TTS
delivery are asynchronous, so nearby speech and synthesis records can
interleave. Use `sessionId`, `turnId`, and `attemptId` for correlation.

## Diagnosing a missing checkpoint

| Last checkpoint seen                                          | Likely boundary to inspect next                                                                |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| No `[stt-tts-debug]` records                                  | Confirm exact activation, Relay restart, and that the session selected `mode: "stt-tts"`       |
| `session.connect.start` without an outcome                    | The named component connection is pending or the process stopped unexpectedly                  |
| `stt.audio.commit` without a recognition outcome              | STT Provider invocation, runtime, endpointing, or final-transcript deadline                    |
| `stt.recognition.complete` without `harness.dispatch.start`   | Adapter-to-Harness handoff or session teardown                                                 |
| `harness.dispatch.start` without queued/complete/failed       | Host routing, Active Host Assignment, or Harness transport                                     |
| `harness.dispatch.complete` without public speech or terminal | Harness Provider stream production or stream validation                                        |
| `tts.synthesis.start` without complete/failed/cancelled       | TTS Provider request or audio-stream iteration                                                 |
| `tts.synthesis.complete` but no audible playback              | Relay-to-Desktop audio event transport and Desktop playback, outside the TTS Provider boundary |

## Privacy and operational limits

The complete finalized STT transcript and complete TTS submission text are
intentionally present and may contain sensitive user content. Protect and
remove diagnostic logs according to the operator's local policy after an
investigation.

The recorder accepts only allow-listed primitive fields. It excludes microphone
and synthesized audio/base64, credentials, tokens, bootstrap secrets,
unrestricted configuration, raw Harness payloads, and private Provider
reasoning. A serialization or log-sink failure is swallowed and never changes
Client events or pipeline control flow.

Durations are Relay boundary measurements. They can include local queueing and
do not claim to isolate model, network, Python runtime, or provider-internal
substeps.

# Real acceptance progress

Date: 2026-09-24

`yarn dev:local` started the Desktop, bundled Relay, and Desktop Host with the local `gpt-sovits-stt` / `gpt-sovits-tts` set and the `codex` Harness Contribution. The Settings selection contained `codex`, `workspace-1`, `binding-1`, `gpt-sovits-stt`, `gpt-sovits-tts`, and `codex`. A call connected and a physical microphone utterance yielded a final transcript. A request from the existing conversation reached the Host but was rejected by the native app-server; the Host connection then closed. A new empty conversation connected, but no further request was observed before the services were stopped.

The separate real GPT-SoVITS provider test passed synthesis and offline recognition. The separate real Codex app-server test produced public Semantic Output and a completed terminal.

On 2026-09-24, the normal Desktop and bundled Relay were started again with the same six Settings values and a disposable Workspace binding. Physical microphone input produced final transcript messages. A typed request in that live session reached the real Codex app-server, returned public text in the AI output panel, and used the selected `gpt-sovits-tts` provider: Relay recorded a completed synthesis of 11 chunks and 83,520 decoded audio bytes, followed by a completed Harness terminal. The public text remained visible after the Turn ended. This is production-path TTS generation and client delivery evidence; a human audible-playback assertion was not recorded.

The owned GPT-SoVITS service was then stopped. In a fresh Desktop conversation, the selected Codex provider returned public screen text. Relay recorded `tts.synthesis.failed` for `gpt-sovits-tts`, while the Desktop displayed the text and the alert `Speech playback unavailable. Check the configured TTS service, then retry.` No replacement TTS provider was selected and no fallback audio was recorded. The required visible, actionable, no-fallback failure is verified. No transcript content, audio payload, or credentials are included in this evidence.

## 2026-09-26 production replay

The operator-started GPT-SoVITS API served the normal Desktop/bundled Relay stack. Default STT and TTS readiness checks both succeeded, the configured Codex Harness handled the request, and Relay produced 16 TTS chunks / 125,760 decoded bytes followed by a completed terminal. The prior visible no-fallback TTS failure remains recorded above. Separate archive review found no remaining blockers after repairs; see `final-review.md`.

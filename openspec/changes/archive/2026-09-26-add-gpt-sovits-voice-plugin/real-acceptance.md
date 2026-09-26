# Real GPT-SoVITS acceptance

Date: 2026-09-23
Host: Windows; local GPT-SoVITS `api_v2.py` on loopback; bundled Python/FunASR runtime

`relay-server/test/integration/gpt-sovits-real.test.ts` ran with the operator's local configuration and its explicit opt-in enabled. The test checks the running API's `/tts` and `/control` paths and required TTS request fields against the recorded synthesis baseline. It checks the bundled ASR script, arguments, and local model assets against the recognition baseline, then sends a real speech unit through `gpt-sovits-tts` and its PCM16 output through `gpt-sovits-stt`.

| Evidence             | Result                                                           |
| -------------------- | ---------------------------------------------------------------- |
| Synthesis baseline   | matched                                                          |
| Recognition baseline | matched                                                          |
| Decoded PCM16 audio  | 198,400 bytes on latest repeat run (208,640 bytes on first pass) |
| Final transcript     | 13 characters                                                    |
| Terminal result      | completed                                                        |
| Failure class        | none                                                             |

The test passed after adding bounded preflight checks. It explicitly skips when the opt-in configuration is absent, the local HTTP service is unavailable, or the offline ASR runtime/model assets are unavailable. No credentials, transcript text, reference-audio contents, or audio payloads are recorded here.

## 2026-09-26 repeat and production readiness

After the operator started the API, the opt-in real synthesis→recognition test passed again (41.03 seconds). It now exercises the default providers' production connect-time checks, independently validating the HTTP synthesis capabilities and offline ASR runtime/script/assets. TTS request cancellation and bounded response lifetime passed public provider regression checks; the independent archive reviews report no remaining blockers. See `final-review.md`.

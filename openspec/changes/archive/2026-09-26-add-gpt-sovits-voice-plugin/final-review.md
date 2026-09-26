# Final archive review — 2026-09-26

The operator explicitly authorized review of uncommitted working-tree changes so the review covers the current implementation rather than only the recorded committed comparison. Standards and Spec were reviewed separately with the code-review skill.

Recorded comparisons: Codex `1f855d75fd58efc9a05cab12014473f1969d5b87`; startup and GPT-SoVITS `2264f0af6186abd25cf8185d635cf049f6ad3239`. The working-tree override supplements those comparisons; no mixed implementation commit was created.

Standards: zero mandatory violations; one nonblocking suggestion to consolidate the two active-Turn maps in the Codex Contribution.

Spec initially found three blockers. All were repaired and re-reviewed:

- Production Codex loads the committed app-server schema before process dispatch, validates its pinned version/fingerprint, and uses Ajv to validate requests, responses, and all consumed notifications. The usage notification missing from the original subset was generated deliberately from the same installed codex-cli 0.153.4 and added to the immutable subset. Fingerprint: `9d4323a9cbd22361d688490c42044ff1d8dbc1fd6085c557768c3d9166eb689e`. Missing artifacts and invalid responses have public regression coverage; invalid usage produces one unknown terminal and no public usage evidence.
- Default GPT-SoVITS connect checks synthesis HTTP capabilities and recognition runtime/script/model assets independently, before readiness is set. Unavailable production boundaries were reproduced in RED and pass their rejection tests in GREEN.
- GPT-SoVITS stop/disconnect aborts in-flight HTTP requests; a 120-second deadline also bounds response reading. A cancelled request settles and a subsequent Turn synthesizes successfully, verified in RED/GREEN through the TTS provider boundary.

The Spec re-review reports no remaining blockers. The development prototype loads the complete external Plugin Package through the explicitly configured plugin root. Desktop build success does not establish schema/plugin resource inclusion in a separately distributed installer; installer resource acceptance is outside this review conclusion.

Real GPT-SoVITS synthesis→recognition acceptance passed again against the operator-started API on 2026-09-26. The physical Desktop request at 20:42 generated 16 audio chunks / 125,760 decoded bytes and a completed terminal with the selected local providers and user-approved GPT-5.6 Luna. Human audible confirmation remains pending; Codex task 4.2 remains unchecked.

Final regression after all repairs: Desktop 325 passed / 2 skipped; Relay 604 passed / 36 skipped; all workspace typechecks passed; Desktop production build passed. Desktop was stopped before the final full suite so the Relay health tests could own port 8080. All three changes passed strict OpenSpec validation. No task completion or archive is inferred from skipped environment-dependent tests.

The operator subsequently confirmed actual audible TTS playback. This supersedes the earlier pending human confirmation statement. Unified spec synchronization and archive are authorized after the remaining Codex disconnect criterion passes.

The remaining physical Host-disconnect criterion passed on 2026-09-26: the real Host received turn.start, its runtime/socket stopped with one pending request, Relay emitted one unknown terminal, and the actual Desktop showed the explicit unknown/no-automatic-replay alert. More than 60 seconds of observation recorded no replay. The user confirmed audible TTS; Codex task 4.2 is now complete. No production code changed during this final manual acceptance.

Final Standards and Spec evidence re-review after task 4.2 completion: Standards has zero hard violations and one existing nonblocking map-consolidation suggestion; Spec has zero remaining blockers. All tasks are complete. The operator authorized sync and unified archive. The owned acceptance stack was stopped and the original Workspace restored, retaining GPT-5.6 Luna; the operator-started GPT-SoVITS API remains running.

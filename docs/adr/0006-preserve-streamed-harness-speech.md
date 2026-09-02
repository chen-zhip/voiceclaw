# ADR-0006: Preserve Streamed Harness Speech

**Status:** Accepted

Relay treats the Harness-authored `speech` field as streamable Semantic Output: separation checks may warn about tables, code, or excessive length but do not suppress or rewrite speech before TTS. Arbitrary transport chunking makes strict structure filtering incompatible with deterministic behavior and low time-to-first-audio; production Harness Integration Contracts should classify speech and screen text before content rather than relying on Relay-side Markdown inference.

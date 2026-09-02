# ADR-0005: Keep Legacy Scaffold Identifiers Behind Canonical Relay Language

**Status:** Accepted

The current Relay scaffold retains the `mode` wire field and internal `HarnessAdapter` identifier for compatibility, while domain prose, user-facing guidance, and new designs use Conversation Pipeline, STT/TTS Harness, and Harness Integration Contract. A full rename would expand the completed scaffold change and risk wire compatibility; `complete-harness-provider-integrations` owns replacement of these legacy identifiers with production Integration Plugin and Capability Profile concepts.

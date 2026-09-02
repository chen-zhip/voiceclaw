# ADR-0007: Keep Supervisor as a Direct-Behavior Scaffold

**Status:** Accepted

Relay retains the `supervisor` wire value for compatibility but does not define it as a separate Conversation Pipeline while its runtime behavior remains S2S Direct. User-facing pipeline choices expose only S2S Direct and S2S Operator; Supervisor can become a distinct pipeline only after its execution semantics exist and the Relay glossary is updated.

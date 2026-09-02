# ADR-0008: Defer Executable Harness Recovery

**Status:** Accepted

The Relay scaffold reports Recovery Guidance for resubmitting input or selecting S2S Direct or S2S Operator, without claiming an executable Harness retry contract. Safe retry requires request identity, side-effect and idempotency semantics, Harness Thread continuity, Capability Profiles, and Client recovery UX; `complete-harness-provider-integrations` owns that protocol, while the scaffold never retries or switches executors automatically.

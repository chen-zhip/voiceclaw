# ADR-0008: Defer Executable Harness Recovery

**Status:** Accepted

The Relay scaffold reports Recovery Guidance for resubmitting input or selecting S2S Direct or S2S Operator, without claiming automatic Harness recovery. `establish-harness-execution-routing` may create a new Harness Execution Attempt after a known pre-dispatch failure, or after the user explicitly acknowledges the side-effect risk of an `Outcome Unknown`; it never reopens or automatically replays the prior Attempt and never silently switches executors. Provider-native resume, status recovery, rollback, and idempotency semantics remain owned by later Provider changes, including `complete-harness-provider-integrations`.

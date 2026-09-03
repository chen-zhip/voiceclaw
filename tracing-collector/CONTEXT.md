# Tracing Collector

The Tracing Collector context receives and persists VoiceClaw telemetry for local observability.

## Language

**Trace Record**:
An observability record of a VoiceClaw session, turn, provider operation, or tool operation.
_Avoid_: Conversation history, agent memory

**Content Diagnostic Mode**:
An explicit, temporary opt-in that permits redacted conversation or workspace content to appear in Trace Records for diagnosis.
_Avoid_: Default tracing, Conversation Archive

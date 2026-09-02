# Mobile

The Mobile context is the paired VoiceClaw experience on a phone and an audio endpoint for VoiceClaw conversations.

## Language

**Mobile Client**:
The VoiceClaw app installed on a phone, with an interactive conversation experience, device settings, and a local projection of Relay-owned history.
_Avoid_: Thin desktop view, Relay host

**Client Projection**:
A disposable local cache of the Conversation Archive used for display and read-only offline access.
_Avoid_: Conversation authority, independent history

**Paired Relay**:
The authenticated Relay selected by a Mobile Client as its conversation control plane.
_Avoid_: AI provider, Harness

**Split-plane Session**:
A session in which media can travel directly between Mobile and a realtime provider while Relay remains the control, authentication, and tool-execution plane.
_Avoid_: Relay-free session

# ADR-0002: Relay Conversation Archive 是历史权威

**Status:** Accepted

## Context

Desktop、Mobile 和 Harness 都可能保存会话记录，多权威会导致跨 Client 不一致、重复合并和删除语义冲突。

## Decision

Relay Conversation Archive 是 VoiceClaw 跨 Client 历史的唯一权威；Client 只保留可丢弃投影。Harness Thread 通过稳定身份单向导入，没有明确 `voiceclawConversationId` 时保持独立，Archive 不反写 Provider 源。

## Consequences

Relay 必须提供受控 Archive API、content-free Catalog、scoped grant、幂等 cursor 和 Import Suppression。Conversation Archive 不承担 Agent Memory 职责。

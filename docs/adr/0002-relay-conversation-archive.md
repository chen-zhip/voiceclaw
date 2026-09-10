# ADR-0002: Relay Conversation Archive 是历史权威

**Status:** Accepted; implementation placement extended by ADR-0009

## Context

Desktop、Mobile 和 Harness 都可能保存会话记录，多权威会导致跨 Client 不一致、重复合并和删除语义冲突。

## Decision

活动 Archive Feature Plugin 的 Relay Archive Authority Contribution 是 VoiceClaw 跨 Client 历史的唯一权威；Client 只保留可丢弃投影。Harness Thread 通过稳定身份单向导入，没有明确 `voiceclawConversationId` 时保持独立，Archive 不反写 Provider 源。默认发行 Profile 安装官方 Archive Feature Plugin，但权威语义不要求其实现硬编码在 Kernel 中。

## Consequences

Archive Feature Plugin 必须通过 Kernel 受控的 Capability Contract 提供 Archive API、content-free Catalog、scoped grant、幂等 cursor 和 Import Suppression。Kernel 保留身份、授权、数据归属、删除和审计底线。Conversation Archive 不承担 Agent Memory 职责；未安装 Archive 时仅允许非持久化实时会话，历史、搜索、导入和 Archive Evidence 能力不可用。

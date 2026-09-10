# ADR-0003: Integration Plugin 使用静态 Capability Profile

**Status:** Accepted

## Context

Claude Code 和 Codex 都只有局部动态能力发现，无法用一个通用协商协议覆盖审批、只读、取消、回滚和恢复等 VoiceClaw 语义。混合探测会扩大 Core 复杂度并产生不一致判断。

## Decision

每个 VoiceClaw Integration Plugin（即 `provider-integration` Contribution）用版本化、硬编码的 Capability Profile 作为唯一 Provider 行为定义。未知 Harness 版本使用最近的已知画像并持续警告；原生动态信息只描述 Provider Availability 和运行时资源，不改变画像。Capability Profile 不等同于 Feature Plugin 的 Capability Contract。

## Consequences

项目接受未知版本会把画像中的全部能力（包括安全和一致性能力）暂时视为可用、错误可能延迟到调用时暴露的风险。失败后会话进入 degraded，保留输入并要求显式回退；Relay、Desktop Host 和 Client 不得按 Provider 名称复制判断。

# ADR-0001: Harness-first 与插件优先边界

**Status:** Accepted; extended by ADR-0009

## Context

VoiceClaw 如果在 Core 中重复实现 Harness 已有的 Agent 能力，会产生两套行为、权限和维护语义。项目同时需要把 Harness 原生扩展与 VoiceClaw 产品接入区分开。

## Decision

Harness 原生行为仍优先由 Harness 本身或 Harness Plugin 承载。Provider 专属接入由薄 VoiceClaw Integration Plugin 承载，只包含协议、版本、能力画像、配置、翻译、导入和少量呈现接入。跨 Harness 的 VoiceClaw 产品能力不再因此自动进入硬编码 Core；ADR-0009 增加 Feature Plugin 与可信 Kernel 的归属判断。

## Consequences

VoiceClaw 保持 Harness-neutral，并避免复制 Harness 行为。Harness Plugin、VoiceClaw Integration Plugin 和 Feature Plugin 处于不同抽象层级，不建立共享运行时基类。任何把可插拔产品能力或 Harness 行为放入 Kernel 的例外都必须通过新 ADR 说明原因与退出条件。

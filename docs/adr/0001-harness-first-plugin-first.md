# ADR-0001: Harness-first 与双层插件模型

**Status:** Accepted

## Context

VoiceClaw 如果在 Core 中重复实现 Harness 已有的 Agent 能力，会产生两套行为、权限和维护语义。项目同时需要把 Harness 原生扩展与 VoiceClaw 产品接入区分开。

## Decision

新增能力依次选择 Harness 原生能力、Harness Plugin、薄 VoiceClaw Integration Plugin，只有跨所有 Harness 成立的 VoiceClaw 不变量才能进入 Core。Harness Plugin 承载 Skill、Command、Tool 和 Workflow；Integration Plugin 只承载协议、版本、能力画像、配置、翻译、导入和呈现接入。

## Consequences

Core 保持较小且 Provider-neutral。任何在 Core 中复制 Harness 行为的例外都必须通过新 ADR 说明插件方案为何不可行以及重复能力的退出条件。

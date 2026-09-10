# ADR-0009: 通用 Feature Plugin 框架与可信 Kernel

**Status:** Accepted

## Context

ADR-0001 正确区分了 Harness Plugin 与 Provider 接入，但把跨 Harness 的产品能力直接归入 Core，无法表达 Archive、Memory、自动化、知识库或协作能力的可安装、可替换和跨运行时组合。DeepSeek Harness 证明了 Profile、Bundle、Service Definition、Provider/Consumer、生命周期和 UI Slot 的组合价值，但其共享进程运行时与日志策略不适合作为 VoiceClaw 的权限和隐私边界。VoiceClaw 还必须保持 Codex、Claude Code、DeepSeek Harness 和未来 Harness 之间的中立性。

## Decision

VoiceClaw 定位为面向多 Harness、多设备的可组合 Agent 交互与能力承载框架。它通过可信 Kernel 组合 Relay、Desktop Host、Client 与 Harness，并以语音交互和官方 Feature Plugin 提供默认产品体验，同时允许开发者扩展或替换数据、模型、工具、自动化和界面能力。

采用“Feature Plugin 负责组合，Contribution 负责实现，Capability Contract 负责解耦”的统一插件模型。VoiceClaw Plugin Package 是顶层交付物；Feature Plugin 是用户管理的逻辑能力；Contribution 是部署到 `relay-service`、`desktop-service`、`client-ui`、`provider-integration`、`harness-extension`、`background-worker` 或 `command/tool` 的实现模块。Harness Plugin 仍是可脱离 VoiceClaw 运行的外部 Harness 扩展；VoiceClaw Integration Plugin 保留 Provider 接入专义，并对应 `provider-integration` Contribution。

可信 Kernel 只保留插件清单校验、生命周期与依赖协调、身份和 Principal、Capability Grant、受控 RPC、数据命名空间、Secret broker、隔离与资源限制、审计、版本协商、migration 协调、generation fencing、late-result rejection，以及不可被插件覆盖的权限、删除和资源归属底线。Service dependency 只表示可用性，不表示授权。插件不得直接访问 Relay 数据库、其他插件存储、完整 Archive 或 Provider credential。

Conversation Archive 与 Agent Memory 作为默认发行 Profile 中的官方 Feature Plugin 交付。Archive 的 Relay Contribution 是安装时的历史权威并提供版本化 Archive Capability；Memory 只通过获授权的 Archive Capability 读取证据。未安装 Archive 时允许非持久化实时会话，但跨设备历史及其依赖能力不可用；未安装 Memory 时 Archive 和普通会话继续工作，且旧 transcript-to-Brain `remember` 行为不得成为隐藏回退。

DeepSeek Harness 仅作为架构参考和未来可接入的 Harness Provider。VoiceClaw 不依赖其 Kernel、共享 Context、默认信任模型或把 reasoning 与 Memory 正文写入同一 Session Log 的策略。

## Consequences

ADR-0001 的 Harness-first 原则继续适用于 Agent 原生行为，但“跨 Harness”不再等于“硬编码进 Core”；产品能力先进入 Feature Plugin，只有不可旁路的组合与安全不变量进入 Kernel。Archive 与 Memory 的领域语义保持不变，但默认实现移入官方 Plugin Packages。`establish-voiceclaw-feature-plugin-kernel` 必须先确定公共合同，Archive 与 Memory 才能编写实现任务。Phase 0 采用已经确认的 `voiceclaw.plugin.json` manifest v0 子集、按 Capability Contract + operation + Scope 的最小 grant，以及第一方受信本地加载规则；完整签名、第三方隔离、通用卸载数据策略和跨设备升级协议仍是后续 `[PROPOSED]`/`[TODO]`，不能由具体 Feature Plugin 私自决定。

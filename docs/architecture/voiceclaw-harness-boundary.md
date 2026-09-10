# VoiceClaw Kernel、Feature Plugin 与 Harness 职责边界指南

> 状态：规范性目标架构
> 最近确认：2026-09-10
> 适用范围：VoiceClaw Kernel、Plugin Package、Feature Plugin、Runtime Contribution、Harness Provider、VoiceClaw Integration Plugin 与 Harness Plugin

本文定义后续开发必须遵守的职责边界。正文描述目标架构，不代表当前代码已经全部实现；已知差距和迁移顺序见文末。出现冲突时，新功能设计应以本指南和相关 ADR 为准，并在改变边界前先更新 ADR。

## 1. 范围与核心原则

VoiceClaw 的长期定位是：**面向多 Harness、多设备的可组合 Agent 交互与能力承载框架。它通过可信 Kernel 组合 Relay、Desktop Host、Client 与 Harness，并以语音交互和官方 Feature Plugin 提供默认产品体验，同时允许开发者扩展或替换数据、模型、工具、自动化和界面能力。**

VoiceClaw 的核心运行面包含以下三个产品上下文：

- **Desktop**：包含 Desktop Client 与 Desktop Host。
- **Mobile**：Mobile Client。
- **Relay**：可独立部署的会话、语音与编排服务。

Website、Documentation、Tracing Collector 和 Tracing UI 属于支持面，不参与一次核心对话的权威决策或执行。

VoiceClaw Kernel 是横跨这些上下文的最小可信职责集合，不是第四个部署进程，也不是 DeepSeek Harness 或其他 Harness 的包装层。Website、Documentation、Tracing Collector 和 Tracing UI 属于支持面，不参与一次核心对话的权威决策或执行。

总规则是 **Harness-first、Feature-Plugin-first、Kernel-minimal**：Harness 自己能够完成的 Agent 行为，不在 VoiceClaw 重复实现；跨 Harness 的 VoiceClaw 产品能力优先作为 Feature Plugin；只有插件组合、安全、授权、隔离、资源归属与一致性所必需的不可旁路机制进入 Kernel。

统一关系是：**Feature Plugin 负责组合，Contribution 负责实现，Capability Contract 负责解耦。** VoiceClaw 保持 Codex、Claude Code、DeepSeek Harness 及其他 Harness 之间的中立性。DeepSeek Harness 只作为架构参考和未来可接入的 Harness Provider。

## 2. 一句话边界

- **Client 管交互**：决定用户在哪里说、说什么、选择哪条路径，并展示状态和结果。
- **Kernel 管可信边界**：校验 Plugin Package，协调 Contribution，通过 Capability Contract 与 Grant 管理跨运行时调用，并强制执行不可绕过的身份、权限、删除、审计、迁移和 fencing 底线。
- **Feature Plugin 管产品能力**：组合 Relay、Desktop Host、Client 与 Harness 侧 Contributions，但不取得 Kernel 权限或其他插件数据的隐式访问权。
- **Relay 管对话控制面**：管理认证、会话、语音输入输出、路由、排队和审批转发；安装 Archive 或 Memory Feature Plugin 后承载其 Relay Contribution。
- **Desktop Host 管本机接入**：管理本机 Provider 生命周期、工作区绑定、原生配置，以及部署到 Desktop 的受信任 Contributions。
- **Harness 管工作**：理解任务、产出语义结果，并负责其工作区和外部系统副作用。

S2S Direct 是明确例外：其活动执行器是 Relay Direct Executor，因此它产生的工具副作用由 Direct Executor 负责，而不是 Harness。

## 3. 权威职责表

| 板块 | 必须负责 | 明确不负责 |
| --- | --- | --- |
| VoiceClaw Kernel | Manifest 校验、生命周期与依赖图、Principal、Capability Grant、受控 RPC、Relay Control State、数据命名空间、Secret broker、隔离、资源限制、审计、版本、migration、generation fencing、late-result rejection，以及删除/权限/资源归属底线 | Conversation 内容、Archive、Memory、自动化等可替换产品语义；Provider 协议；Harness Agent 行为 |
| VoiceClaw Plugin Package | 交付一个 Feature Plugin 定义、Contributions、合同声明、配置 Schema、权限、兼容范围、升级与数据处置声明 | 获得隐式信任；跨越 Kernel 授权；把所有 Contribution 当作同一进程对象 |
| Feature Plugin | 作为用户可安装、启用、配置、升级和管理的逻辑产品能力，组合多个 Runtime Contributions | 充当共享运行时基类；复制 Provider Integration；决定 Kernel 安全底线 |
| Contribution | 在声明的 Relay、Desktop、Client、Provider、Harness、Worker 或 Command/Tool 扩展点实现一部分功能，并独立报告状态 | 代表整个 Feature Plugin 的启用或健康状态；直接访问其他插件数据 |
| Client（Desktop renderer / Mobile） | 采集文字与音频、播放语音、选择 Pipeline/Provider/Workspace、意图确认、审批交互、队列和结果展示，以及获授权的 `client-ui` Contribution | 历史权威、Provider 能力判断、执行任务、保存原生凭据、直接操作 Harness |
| Desktop Host | 本机服务与进程监督、操作系统集成、Provider 检测与启动、Workspace Binding 的本地解析、原生路径与凭据引用、Assignment readiness 报告，以及 Desktop Contributions | 拥有 Active Host Assignment、修改工作区内容、决定任务语义、拥有跨 Client 历史、绕过 Relay 开始产品会话 |
| Relay | Client 认证与配对、Conversation Pipeline、语音编排、Conversation Turn Queue、无内容 Relay Control State、逻辑 Provider/Workspace 绑定、Active Host Assignment 及其 generation、审批路由，以及 Relay Contributions 的受控宿主 | 将控制状态扩展成对话历史、执行 Harness 工作区任务、保存原始 Provider 凭据、按 Provider 名称硬编码、静默切换执行器 |
| VoiceClaw Integration Plugin | 作为 `provider-integration` Contribution 处理 Harness 原生协议、版本、静态 Capability Profile、事件翻译、状态采集、历史导入适配和少量 Provider 元数据 | 重新实现 Agent 技能/工作流、拥有 Archive/Memory、直接访问 Relay 数据库 |
| Harness | 任务理解与语义输出、Harness Thread、工具调用、工作区/外部系统副作用、原生审批执行、取消/回滚/恢复语义、原生认证和凭据存储 | VoiceClaw 跨 Client 历史权威、语音管线、Client 交互 |
| Harness Plugin | 可脱离 VoiceClaw 安装运行的 Harness 原生 Skill、Command、Tool、Workflow、Prompt 与 Agent 行为扩展；VoiceClaw 可通过 `harness-extension` Contribution 管理它 | VoiceClaw Runtime Contribution、传输协议、跨 Client 归档 |
| Brain Agent | S2S Operator 中 `ask_brain` 委派任务的语义与副作用 | 外层实时语音会话、Harness Thread |
| Relay Direct Executor | S2S Direct 中工具调用及其副作用 | Harness 工作区语义、Operator 任务 |

## 4. 新功能归属判断顺序

每个功能提案必须依次回答以下问题，并在设计或 PR 中记录首次命中的判断：

1. **Harness 已原生支持吗？** 支持则直接调用，不在 VoiceClaw 重做。
2. **能通过 Harness 原生扩展机制完成吗？** 能通过 Skill、Command、Tool、Workflow 或 Prompt 完成，则实现为 Harness Plugin；VoiceClaw 需要管理它时增加 `harness-extension` Contribution。
3. **是否只处理某个 Provider/Harness 的接入差异？** 是则实现为 `provider-integration` Contribution，并沿用 VoiceClaw Integration Plugin 专名。
4. **是否是跨 Harness 的完整 VoiceClaw 产品能力？** 是则实现为 Feature Plugin，通过 Capability Contract 组合所需 Contributions，不把行为硬编码进 Kernel。
5. **是否是任何插件都不得绕过的组合或安全不变量？** 只有 Manifest、身份、授权、隔离、受控 RPC、资源归属、删除、审计、版本、migration 和 fencing 等机制进入 Kernel。
6. **若仍要在 Kernel 重复实现产品或 Harness 行为**，必须通过 ADR 说明插件方案为何不可行、权威来源、同步成本和退出条件。

Planning Workflow 是上述顺序的规范示例：规划提示、命令、工具、状态和语义结果属于外部 Harness Plugin；VoiceClaw 侧 Planning Feature Plugin 可以用 `harness-extension` 和 `client-ui` Contributions 提供发现、安装、选择与呈现，并通过薄 `provider-integration` Contribution 翻译调用，但不能建立第二套 Planning 行为层或复制 Provider Integration。

简化判断式：

```text
Harness 原生能力
  → Harness Plugin / harness-extension Contribution
    → provider-integration Contribution（Provider 接入差异）
      → Feature Plugin（跨 Harness 产品能力）
        → VoiceClaw Kernel（仅不可旁路不变量）
```

## 5. 三条执行路径不得混为一条

VoiceClaw 保留三条显式 Conversation Pipeline。它们可以复用传输、事件、归档和 UI 基础设施，但不得用一个泄漏实现细节的“统一 Agent Backend”掩盖不同执行权威。

| Pipeline        | 输入与输出                            | 活动执行器                      | 副作用权威                 |
| --------------- | ------------------------------------- | ------------------------------- | -------------------------- |
| S2S Direct      | 实时 S2S 语音                         | Relay Direct Executor           | Relay Direct Executor      |
| S2S Operator    | 实时 S2S 语音，必要时调用 `ask_brain` | Realtime Provider + Brain Agent | 产生该副作用的 Brain Agent |
| STT/TTS Harness | STT 定稿文本 → Harness → TTS          | Harness Provider                | Harness Provider           |

S2S 是默认稳定路径，STT/TTS Harness 是用户主动选择的扩展路径。任何路径失败时，VoiceClaw 必须保留原输入和会话，并提供重试、更换 Provider 或返回 S2S 的显式选择；不得静默把任务交给另一执行器。

## 6. STT/TTS Harness 的调用链

```text
Client
  → Relay（认证、STT、排队、路由；可选调用 Archive/Memory Capability）
    → Active Desktop Host（本机接入、工作区绑定）
      → provider-integration Contribution / Integration Plugin（协议翻译、能力画像）
        → Harness Provider（任务执行、审批、副作用、语义结果）
    ← Relay（校验、事件路由、TTS、展示状态）
  ← Client
```

Relay 可以校验结构、解析事件、路由、合成语音、选择降级呈现和生成 Presentation State，但不得改写 Harness 的 Semantic Output。Desktop Host 建立 Workspace Binding，却不得代替 Harness 修改绑定工作区。

Desktop Client 不得为了“本机更快”绕过 Relay 直接与 Harness 聊天。Desktop Host 可以重启或重连本机 Provider，也可以监督随 Desktop 分发的本地 Relay，但被监督的 Relay 仍保持同一协议与权威边界。

## 7. Provider 能力与可用性

### 7.1 Capability Profile 是唯一能力定义

每个 Integration Plugin 必须内置版本化、硬编码的 Capability Profile。Relay、Desktop Host 和 Client 只消费统一画像，不得按 `claude`、`codex` 或其他 Provider 名称分支。

判断顺序：

1. 通过 `providerId` 定位已安装且启用的 Integration Plugin。
2. 插件识别 Harness 版本。
3. 精确版本命中时选择精确 Capability Profile。
4. 未命中时选择最近的已知画像，并持续显示“版本未经验证”警告。
5. 将画像中的全部能力作为 VoiceClaw 语义，包括审批、强只读、取消、回滚和会话恢复。
6. 原生调用失败时把会话标记为 degraded，并走显式回退，不动态重写能力语义。

这是有意接受的兼容性风险：未知版本的错误可能延迟到调用时才暴露。禁止为了覆盖全部版本而在 Kernel 中引入通用动态协商系统。

### 7.2 动态信息只描述运行状态

Harness 的 init capability、模型、工具、MCP、实验功能等运行时信息可以用于：

- 展示当前模型、工具和资源清单；
- 判断进程、传输、会话是否健康；
- 诊断错误并更新 Provider Availability；
- 帮助 Integration Plugin 作者维护下一版静态画像。

动态信息不得添加、删除或改变 Capability Profile 中的能力。

Provider Availability 不是一个布尔值，至少应区分：插件已注册、运行时已检测、画像已选择、进程/传输就绪、会话就绪、degraded 和 unavailable。

## 8. 会话、并发与审批

### 8.1 Thread 与并发

- Relay 持久保存 `(conversationId, providerId, workspaceId) -> harnessThreadId`。
- Provider 或 Workspace 改变时创建新的映射，不复用原 Thread。
- 同一 Conversation 的输入由 Relay 串行处理，最多一个 Harness turn 处于活动状态；其余输入进入可见队列。
- 只有用户显式 interrupt 才能中断当前 turn。

### 8.2 两种确认不可合并

- **Intent Confirmation**：VoiceClaw 确认系统对用户意图的理解。
- **Provider-native Approval**：Harness 决定某个工具或权限是否允许，并负责执行约束。

Provider-native Approval 通过 Integration Plugin → Relay → 当前活动 Client 呈现。其他已配对 Client 可以显式接管。没有 Client 在线时，维持 Harness 原生等待或超时语义；VoiceClaw 不设置替代超时，也绝不自动批准。

### 8.3 Active Desktop Host

同一 Provider + Workspace 同时只能有一个用户选择的 Active Desktop Host。Standby Host 不自动接管、不迁移 Harness Thread；切换必须由用户发起并建立新状态或按 Provider 原生恢复能力处理。

### 8.4 Native TUI Handoff

Native TUI Handoff 是把一个空闲 Harness Thread 的活动控制权显式交给 Provider 原生终端，而不是让 Desktop Client 绕过 Relay 继续 VoiceClaw 对话。

- Relay 只允许空闲 Thread 开始 handoff，并暂停该 Conversation 的 Turn Queue。
- handoff 期间 Provider 原生终端是唯一活动控制器；VoiceClaw 不发送新 turn、不代答审批，也不声称拥有该段交互。
- TUI 结束后，Relay 才恢复队列，并通过 Harness History Import 单向导入新增 Provider 历史。
- Desktop Host 只负责在 Active Host 上启动和监督本机终端。外部 Relay 通过合同请求 Active Host 执行，不能假设终端与 Relay 位于同一机器。

## 9. Conversation Archive 与 Harness 历史

### 9.1 权威与方向

- 当前活动 Archive Feature Plugin 的 Relay Archive Authority Contribution 是跨 Client 历史权威。默认发行 Profile 安装官方 Archive Feature Plugin，但 Kernel 不硬编码唯一存储实现。
- Desktop/Mobile 仅保留可丢弃的 Client Projection，用于显示和只读离线访问。
- 本项目面向个人使用；同一用户的配对 Client 共享历史，不做按单个 Client 的会话隔离。认证和 Workspace 权限仍然有效。
- Harness Thread 是 Provider 的工作会话，不等同于 Conversation Archive。
- Harness 历史只允许 Harness → Relay 单向导入；Relay 不反写、不修改、不删除 Provider 源 Thread。

Relay 在用户手动要求时，或在某个 Provider + Workspace 开启“自动同步 Harness 历史”后于 Relay 启动时，导入没有通过 VoiceClaw 输入的 Harness 对话。自动同步只在启动时运行，不做周期轮询；同步在后台执行，不阻塞 Relay 可用。

### 9.2 身份、合并与来源

- Integration Plugin 应提供稳定的 provider、workspace、thread、event、revision 标识和增量 cursor。
- 有明确 `voiceclawConversationId` 时才合并到对应 VoiceClaw Conversation。
- 没有明确映射时，按 `(providerId, workspaceId, threadId)` 建立独立 External Conversation；禁止按内容、标题或时间启发式合并。
- 来源使用结构化 Conversation Origin，表达 `voiceclaw` 或具体 Harness Provider/Thread，不使用 `isVoiceClaw` 布尔字段。
- 只有不提供稳定身份的 Provider 才允许带警告的一次性手动导入；不得为其开启自动同步。

### 9.3 内容与删除语义

标准化导入内容包括可见 transcript、时间、role、工具调用、审批、结果和附件引用。Provider 专属字段进入命名空间 metadata。不得导入私有 thinking、凭据或 secrets。

- 已归档事件不可变。
- 插件可以写入带命名空间、版本和来源的 Derived Archive Record，只能删除自己产生的派生记录。
- Provider 源内容后来删除或不可见时，Relay 保留归档并标记 source missing/deleted。
- 只有用户显式删除 VoiceClaw 归档才移除内容；删除 External Conversation 时创建 Import Suppression，防止下次同步重新导入。
- 默认保留至用户显式删除或配置的 retention 到期。

### 9.4 Archive API、权限与 Catalog

Archive Feature Plugin 通过 Kernel 注册 `archive.append`、`archive.read`、`archive.search`、`archive.import` 和 `archive.evidence.resolve` 等版本化 Capability Contract。其他插件只能持 Capability Grant 调用受控接口，禁止直接访问 Archive 数据库或插件数据命名空间。

- 默认 grant 必须声明 Provider、Workspace、时间范围和内容类型等范围，并可撤销、持久化和审计。
- `archive.read.all` 是用户可手动授予的显式全量权限，同样可撤销并接受审计。
- 所有已安装且启用的插件都可以读取 content-free Archive Catalog，以发现已有 Provider、Workspace、时间覆盖、内容类型和同步状态。
- Catalog 不得暴露对话内容、绝对路径、凭据、secrets 或 private thinking。

同步状态按来源保存 cursor、最近成功、最近错误和缺口；允许部分成功，并按稳定身份幂等重试。

Conversation Archive 不是 Agent Memory。长期记忆由 Memory Feature Plugin 从授权内容派生，不能依赖 Relay 无条件把 transcript 写进另一个执行器。Memory 只能通过 Archive Capability 和独立授权读取证据。

未安装 Archive Feature Plugin 时，VoiceClaw 可以保留非持久化实时 Conversation；跨设备历史、搜索、导入、Client Projection 和依赖 Archive Evidence 的功能必须明确不可用，不能由 Client 本地数据库或 tracing 隐式接管权威。

### 9.5 Agent Memory Feature Plugin

默认 Memory Feature Plugin 可以组合 Relay Memory Authority、Desktop Memory Producer、Embedding Provider、Retrieval Provider、Memory Context Consumer、Desktop/Mobile 管理 UI，以及可选 Harness Tool Contributions。不同 Contributions 独立报告 `PENDING`、`LOADING`、`ACTIVE`、`DEGRADED`、`FAILED` 或 `DISPOSED`；Desktop Host 离线可以使生产与 embedding 暂停，而不把 Relay 中已有 Memory 读取和治理状态误报为完全失败。

此前确认的 Relay 权威、Desktop-only Memory Producer、Memory Inclusion、首次 opt-in、Conversation 独立控制、Memory Scope、named grant、Decision Context、私有 Chain of Thought 排除、统一管理面板、Outcome Evidence 限制、Memory Suppression 和两阶段删除继续成立。这里的“Relay 权威”指活动 Memory Feature Plugin 的 Relay Authority Contribution 在 Kernel 授权与删除底线内拥有 Memory 领域状态，不表示 Memory 是 Kernel 硬编码实现。

未安装 Memory Feature Plugin 时，Archive 与普通 Conversation 继续工作，Memory 控制、生产、检索和 Tool 不出现；旧 transcript-to-Brain `remember` 行为不得作为隐藏回退。

## 10. Plugin Package、配置、凭据与信任

- Phase 0 的实现中立合同统一放在内部 `packages/contracts` workspace（包名 `@voiceclaw/contracts`）。Kernel、Relay、Desktop Host、Client 和 Provider Contribution 可以依赖这里的 schema 与类型，但该包不得导入任何 Archive、Memory 或 Provider 实现；依赖中立合同不是对其 Provider 的运行时依赖。
- 长期 Plugin Manifest 仍覆盖完整生命周期、migration 与数据处置；原型 Phase 0 只接受 `voiceclaw.plugin.json` 的 manifest v0 子集：`manifestVersion: 0`、小写 kebab-case 全局 package `id`、SemVer `version`、`voiceclawVersionRange`、一个 `{id, displayName}` Feature，以及包含 `id/type/runtime/entry/provides/requires/configSchema/requestedPermissions` 的 Contributions。其固定生命周期为 startup 激活、停用/更新需重启、卸载不支持、数据保留。
- Phase 0 只发现 VoiceClaw 随附的第一方 package root 或开发 Profile 明确 allowlist 的 root；`entry` 必须规范化为 package root 内的相对路径。Desktop 加载本地 Contribution，Relay 只复核无 secret 的 Manifest projection。
- Feature Plugin 是管理单元；Contribution 是运行单元。同一 Feature Plugin 的 Contribution 可以处于不同状态，且缺少某个离线运行时只使依赖它的能力 `PENDING` 或 `DEGRADED`。
- `ACTIVE` 只表示 Contribution 已加载且合同可调用，不等同于 Provider process/transport/Session ready；后者单独呈现，必要时令 Provider Contribution `DEGRADED`，设置 UI 仍可保持 `ACTIVE`。
- Service dependency 或 `inject` 只表示能力可用性，不授予数据权限。所有跨插件或跨运行时调用都必须经过 Kernel 授权的 Capability Contract 与受控 RPC。Phase 0 grant 精确到 Capability Contract + operation + Scope；secret/workspace 再受声明的引用或 binding 限制。
- Phase 0 的 `harness.execution@1` 提供 `provider.describe`、`thread.ensure`、`turn.start`、`turn.cancel`。Kernel Invocation Envelope 承载合同/版本、operation、invocation、Principal、选中 Contribution、generation、Scope 和 trace；Harness payload 再承载 binding/Thread/Turn/Attempt/sequence，流必须恰有一个 terminal，并拒绝 stale generation、重复 sequence 和 terminal-late event。
- Provider Integration 必须在 Desktop 边界内丢弃 raw private reasoning；Host RPC、Relay、Client、Archive 和其他 Feature Plugin 只能获得公开 Semantic Output、Presentation State、受限 Outcome Evidence 与无内容诊断。Feature Plugin 仍可在获授权时调用独立的 model-inference Capability 生成新的公开结构化结论，这不等于读取原执行的私有 Chain of Thought。
- 插件不得直接访问 Relay 数据库、其他插件的数据命名空间、完整 Archive 或 Provider credential。Secret broker 只向已授权运行时提供不透明使用能力或最小必要 secret material。
- Relay 保存 Logical Provider Binding、Active Host Assignment 及其 generation、Integration Plugin 标识和非敏感偏好。
- Relay 通过 Kernel-owned `ControlStateStore` 持久化 Relay Control State；Phase 0 使用带单调 revision、进程内串行提交和原子替换的单一 JSON 文档，写入失败必须保留上一有效版本，过期 expected revision 必须失败而不能覆盖新状态。该存储只包含 grant、Host 注册/撤销、Active Host Assignment generation 和无消息内容的 Conversation Thread Mapping，不属于插件数据命名空间，也不能由插件直接访问。
- Conversation Thread Mapping 位于独立于 Archive 的 Relay Control State 中。Provider/Host 暂不可用时 mapping 进入 dormant；Forget Thread Mapping 或 Conversation 删除只移除 VoiceClaw 指针，不删除 Provider-owned Thread。
- Desktop Host 保存本机路径、可执行文件位置、启动配置和不透明凭据引用。
- Client 通过 Relay/Desktop 提供的接口编辑配置，不直接修改本机存储。
- Harness 使用原生认证与凭据存储；Relay、Client 和 Conversation Archive 永不保存原始凭据。
- 对远程 Relay，Desktop owner/Client 用一次性短期 enrollment token 换取每安装一个、可撤销、持久化于 OS secure storage 的 Host Credential；Phase 0 提供 owner-only Host 状态/撤销/重新注册管理。对 Desktop 自己启动的 bundled local Relay，不签发 Relay 长期凭据，而使用 Desktop 每次 stack 启动生成且不持久化的 Local Host Bootstrap Secret。
- 第一阶段的第三方插件隔离、签名和安装信任方案尚未确认；任何暂时采用的受信本地代码模型都不能绕过 Capability Grant、Archive API、审计或数据命名空间。
- VoiceClaw Profile 组合启用的 Plugin Packages、Capability Provider、配置覆盖和运行时部署，并应能显示最终有效插件图。Phase 0 的 Manifest 子集和权限粒度已经确认；第三方隔离、完整签名、通用卸载数据处置和跨设备升级协议仍由后续 Kernel phases 确认。
- Manifest 的 required Capability 依赖参与激活图；运行时 optional Capability lookup 不形成激活边。未安装 Archive/Memory 时最小原型 Profile 正常启动，并在有效图中显示能力缺失而非 Core failure。已安装的可选 Provider 调用失败或超时时，只把该功能标记为显式 degraded，Harness Turn 继续按自身 terminal outcome 完成，且不得自动选择另一实现或旧存储回退。

## 11. Relay 部署边界

Relay 是可独立部署的核心运行面服务。Desktop 可以为了个人本地使用而捆绑、启动和监督一个 Relay 实例，但这只是部署便利，不把 Relay 的职责并入 Desktop，也不使 VoiceClaw Kernel 等同于 Relay 进程。

- 外部 Relay 不受任一 Desktop 退出影响。
- Desktop 退出时只能停止自己明确启动并拥有的本地 Relay 子进程。
- Client、Integration Plugin 和 Harness 的合同不得依赖“Relay 一定与 Desktop 同进程或同机器”。

## 12. 可观测性边界

Tracing 默认只记录 metadata，例如阶段、耗时、Provider、状态和错误类别。内容诊断必须由用户显式开启并经过脱敏。Tracing Collector 不是 Conversation Archive，也不能成为恢复历史的来源。

## 13. 开发准入清单

实现或评审新功能时逐项确认：

- 是否按第 4 节判断顺序选择了最外层扩展点？
- 是否区分了 Plugin Package、Feature Plugin、Contribution 与 Capability Contract，而没有建立伪共享基类？
- 是否声明每个 Contribution 的运行时、依赖、权限、独立状态和卸载行为？
- 是否通过 Capability Grant 与受控 RPC 访问其他功能，而没有直连数据库、存储或凭据？
- 是否明确了活动执行器和 Task Side Effect 权威？
- 是否让 Relay 保持 Provider-neutral，避免 Provider 名称分支？
- 是否区分 Capability Profile 与 Provider Availability？
- 是否避免 Client、Desktop Host 或 Tracing 成为第二历史权威？
- 是否区分 Intent Confirmation 与 Provider-native Approval？
- 失败时是否保留输入和会话，并要求用户显式选择回退？
- 是否避免把凭据、private thinking 或未脱敏内容写入 Archive/Tracing？
- 是否补充或更新测试、Context 文档和必要 ADR？

## 14. 当前实现差距与两条交付路径

以下是截至 2026-08-31 的实现快照，只用于安排迁移，不能反向定义边界：

`add-stt-tts-mode` 已归档，并在 OpenSpec 中记录 145/145 tasks complete；截至 2026-08-31，其相关 57 项聚焦测试和 test typecheck 通过。这只表示旧 proposal 所定义的 Relay scaffold 和测试合同完成，不表示 STT/TTS Harness 已达到本指南的目标架构或可供真实 Provider 使用：现有端到端测试使用边界 fake，真实 Harness runtime 与 Client 入口仍缺失，且通用 Adapter 的部分方法仍是 no-op。归档状态和 task-complete 不得被解释为 production-ready；现有代码和 artifacts 只作为后续迁移基线。

1. Desktop 与 Mobile 仍各自保存独立 SQLite conversation，尚未成为 Relay Archive 的投影。
2. Harness adapter/registry 仍主要位于 Relay，使用布尔 availability；Claude 接入是 HTTP chat-completions 形态，Codex 尚未形成可运行集成。
3. Desktop/Mobile 尚未完整提供 STT/TTS Harness 路径选择。
4. composed adapter 的部分 frame、tool、inject 与 transcript 行为仍是 no-op/空结果。
5. Relay 当前会把 S2S transcript 无条件同步给 OpenClaw brain，形成第二记忆权威风险。
6. Pi/Codex/Hermes 等 AgentBackend scaffold 仍路由到 OpenClaw，掩盖了三条执行路径的实际权威。
7. Desktop 当前管理本地 Relay 子进程；实现需明确只停止自身拥有的 bundled instance。
8. Tracing 当前可能采集内容，尚未落实 metadata-first + content opt-in。
9. 公开架构文档主要描述 S2S/Brain 路径，尚未覆盖本指南的 Harness 与 Archive 目标。

当前优先交付一个可以实际调用真实 Harness 的 Desktop 端到端原型。`add-stt-tts-mode` 继续作为已经归档并经过测试的 scaffold 基线，不重新打开；其 fake/no-op/空结果路径、Relay-side Adapter、缺失的 Client 入口和真实 Provider 由后续 changes 补齐。

原型关键路径：

1. `establish-voiceclaw-feature-plugin-kernel`：只交付 Phase 0 所需的 `packages/contracts`、受信本地插件、最小 Manifest、Contribution 状态、Capability/Grant、Relay Control State、Desktop Secret broker、Relay ↔ Desktop RPC、fencing 和有效图。
2. `establish-desktop-harness-host-contract`：建立单 Host、单 Active Host Assignment 的出站认证 WSS、Native Provider Configuration、进程/Session readiness 和 Host 断线语义。
3. `establish-harness-execution-routing`：建立 Turn/Attempt/Thread Mapping、STT 定稿派发、流式输出、TTS、取消、Outcome Unknown 和显式恢复选择；Archive 与 Memory 仅按可用 Capability 调用，并以确定性的 provider-neutral `harness.execution@1` fixture 完成自身验收。
4. `integrate-codex-provider-prototype`：交付首个真实 Codex app-server Plugin Package/Integration Plugin vertical slice；只有此 change 承担真实 app-server 和物理麦克风端到端验收。
5. 使用真实、已安装且已认证的 Codex app-server 验收 `Desktop microphone → Relay STT → Desktop Host → Codex → streamed Semantic Output → Relay TTS → Desktop playback`。fixture、fake、no-op 或普通 Chat Completions endpoint 均不能替代此验收。

延后功能路径：

1. `establish-voiceclaw-feature-plugin-kernel`
2. `establish-relay-conversation-archive`：保留已确认的 Archive proposal/spec/design 与数据语义，但不阻塞无持久化原型。
3. `establish-relay-agent-memory`：继续作为默认官方 Memory Feature Plugin，并只通过 Archive Capability 读取授权证据。
4. 其他 Feature Plugin、第二/第三个 Harness Provider、Harness History Import、Native TUI Handoff、Cherry Studio、Planning 和 Voice Confirmation。

未安装 Archive 时，Conversation 只在当前 Relay Session 中存在且重启后可丢失；Client SQLite、Tracing 或 Brain transcript 不得升格为替代权威。未安装 Memory 时，不检索、不生产、不显示 Memory 控制，也不得调用旧 transcript-to-Brain `remember` 回退。

最小原型 Profile 明确不安装 Archive 或 Memory，只组合 Kernel、Desktop Host、Harness Execution Routing、Codex Provider 与 STT/TTS。它必须能够启动并完成真实 Harness 语音链路；Relay Control State 可以跨重启保留控制身份，但不得据此恢复 Conversation 内容。Archive/Memory Provider 已安装但单次调用失败时，失败以功能级 degraded 状态呈现，不能改变 Harness terminal outcome、阻塞 TTS/Client 结果或触发隐式回退。

## 15. 相关决策与研究

- [Harness-first 与插件优先边界](../adr/0001-harness-first-plugin-first.md)
- [通用 Feature Plugin 框架与可信 Kernel](../adr/0009-feature-plugin-framework-and-trusted-kernel.md)
- [原型优先的双 change 路径与首个 Codex Provider](../adr/0010-prototype-first-dual-change-paths.md)
- [Relay Conversation Archive 权威](../adr/0002-relay-conversation-archive.md)
- [静态 Integration Capability Profile](../adr/0003-static-integration-capability-profiles.md)
- [Relay 独立部署边界](../adr/0004-independent-relay-boundary.md)
- [Claude Code 与 Codex 能力发现研究](../research/harness-capability-negotiation.md)
- [DeepSeek Harness 插件架构研究](../research/deepseek-harness-plugin-architecture.md)

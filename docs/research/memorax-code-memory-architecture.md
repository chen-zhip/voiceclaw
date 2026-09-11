# MemoraX Code 记忆架构研究

> 日期：2026-09-05
> 范围：仅使用 `memorax-ai/memorax-code` 的 README、架构文档、配置文档和公开源码说明。MemoraX 云端 Memory API 的内部实现不在该仓库中，因此本文不会推断其数据库、LLM 或 embedding 实现。

## 结论

MemoraX Code 不是一个嵌入各 Coding Agent 的向量库，而是一个本地集成层：不同 Agent 的 Hook/Plugin 把带有可靠 Session、Turn 和 Repository Scope 的命令交给本地 Backend；Backend 校验客户端原生 transcript、执行检索与后台 writeback 工作流，再调用远端 MemoraX Memory API。模型、模型凭证、原生工具和 transcript 创建仍由 Codex、Claude Code 等客户端拥有。

对 VoiceClaw 最值得借鉴的是边界和失败语义：

1. Provider-specific 解析留在客户端适配器，通用 Memory 协调层不猜测原生 transcript。
2. 检索和 Memory Inclusion 是独立能力、独立开关。
3. 只处理身份可证明的完整 Turn；缺少 Session、Turn 或 Scope 时 fail closed。
4. 自动 writeback 是异步分支，不阻塞正常对话完成。
5. Viewer、trace 和任务投影都不是 Memory 或 transcript 权威。

VoiceClaw 不应直接照搬其远端 Memory API 依赖、Repository-only Scope 或默认内容型本地 trace。

## 系统边界

MemoraX Code 由六类 Agent Adapter、一个本地 Backend、共享 adapter runtime、CLI/npm 生命周期层以及远端 MemoraX API 组成。Adapter 通过版本化的本地 HTTP 命令连接 Backend。架构文档明确规定 Backend 不拥有模型执行、模型 Provider 凭证或客户端原生 transcript 创建。[Architecture](https://github.com/memorax-ai/memorax-code/blob/main/ARCHITECTURE.md#2-system-shape-and-package-ownership)

运行数据流大致为：

```text
Codex / Claude / DSH / OpenCode / WorkBuddy / Trae
                    │ native Hook / Plugin event
                    ▼
         Provider-specific Adapter
                    │ versioned local HTTP
                    ▼
             Local Backend
        ┌───────────┴────────────┐
        ▼                        ▼
native transcript          repository scope
validation                 validation
        └───────────┬────────────┘
                    ▼
            MemoraX Memory API
```

客户端原生记录才是内容权威：例如 Codex rollout JSONL、Claude/WorkBuddy transcript JSONL、DSH 的精确持久事件区间、OpenCode SDK message records。通用 Memory 层不能混合、猜测或用其他客户端格式兜底。[Hook and retrieval data flow](https://github.com/memorax-ai/memorax-code/blob/main/ARCHITECTURE.md#32-hook-and-retrieval-data-flow)

## Memory 类型与 Scope

README 区分四类 Memory：

| 类型 | 目的 |
| --- | --- |
| Coding Memory | 跨任务复用修复经验、失败路径、设计依据和回归检查 |
| Repo Memory | 描述仓库架构、模块职责、入口和 Git/Issue/PR 证据 |
| Personal Memory | 保存语言、语气、解释深度等用户协作偏好 |
| Procedure Memory | 保存可复用步骤、检查表、前置条件和例外 |

Personal 和 Procedure Memory 可以存入当前仓库的 `.repo_memory/`。系统会比较语义后更新冲突项；明确 forget 只删除被点名的内容，一次性指令不会自动改写持久 Memory。[README: Four Clear Memory Boundaries](https://github.com/memorax-ai/memorax-code#four-clear-memory-boundaries)

云端调用使用 Base User ID 派生 Repository-scoped identity；Git Workspace 使用经过验证的 Git scope，非 Git Workspace 使用 folder scope，并明确禁止退回未限定范围的 Base User ID。[Configuration: MemoraX connection](https://github.com/memorax-ai/memorax-code/blob/main/docs/configuration.md#memorax-connection)

这对 VoiceClaw 的启示是 Scope 必须来自权威绑定而不是任意 `cwd`。但 VoiceClaw 还需要 User-global、当前 Workspace、具名跨 Workspace grant 和 Conversation 权限，不能把 Git repository identity 原样当作完整授权模型。

## 检索

自动检索默认关闭，显式 CLI Search 仍可在凭证和可信 Workspace Scope 成立时使用。当前配置支持 dense/sparse 数量、最低分数、单项长度、总上下文长度以及按 Memory 类型渲染。[Configuration: Retrieval](https://github.com/memorax-ai/memorax-code/blob/main/docs/configuration.md#retrieval)

检索结果通过 Adapter 注入客户端原生上下文。MemoraX 还要求在 Memory 实际影响任务时向用户做简短自然语言披露。[README: Product Capabilities](https://github.com/memorax-ai/memorax-code#product-capabilities)

可借鉴到 VoiceClaw：

- 自动注入必须有条目数和上下文字符预算；
- 主动 `memory.search` 与自动注入使用相同 Scope/Grant；
- Memory 权限不能间接授予原始 Archive 内容访问；
- Memory 确实影响结果时可以提供可见但简短的来源提示。

公开配置出现 dense 与 sparse 检索参数，但这不足以证明 MemoraX 云端使用哪种向量数据库、embedding 模型或混合排序算法。

## 自动 writeback

自动 writeback 与检索是不同分支。客户端先提供完成信号和相关身份，本地组件再从客户端原生内容权威读取匹配 Turn、重新验证 Repository Scope、加入本地缓冲，并异步发送给 MemoraX Add API。[Architecture: Automatic writeback](https://github.com/memorax-ai/memorax-code/blob/main/ARCHITECTURE.md#34-automatic-writeback)

公开规则只接受匹配的用户文本和已完成、可见的 Assistant 内容；工具、推理、召回内容、摘要/压缩伪消息、不完整 Turn 和身份不匹配内容被排除。失败或中断不会退回猜测的 prompt 或其他本地记录。

配置支持按 Turn 数、时间和字符数缓冲，并在发送前分块。自动 writeback 会先限制消息长度，再使用本地 best-effort detector 替换常见私钥、token、cookie、API key、邮件、长号码和 opaque ID；脱敏后没有有效内容则不发送。[Configuration: Writeback and redaction](https://github.com/memorax-ai/memorax-code/blob/main/docs/configuration.md#writeback-and-explicit-add)

README 明确说明自动 writeback 发送选定的用户指令和对应最终回答，不上传完整 retained trace 或 trace 路径。[README: Your Memory, Your Control](https://github.com/memorax-ai/memorax-code#your-memory-your-control)

可借鉴到 VoiceClaw：

- 在 Conversation idle/完成后批量产生 Memory Candidate，而不是每个 token 或事件调用 Producer；
- 只向 Producer 授予当前批次必需的规范化内容；
- Memory Production Request 持久化 request ID、Evidence 范围和状态，支持断点协调；
- incomplete、interrupted 和 outcome-unknown Turn 默认不纳入 Memory 生成；
- 本地脱敏是降低风险的防线，不应被描述为完整 DLP。

## 编辑、删除和观察

MemoraX Console 被描述为云端 Memory 的查看、编辑和删除控制面；显式 forget 会尽量只删除被点名的偏好、Procedure topic、section 或 step。[README](https://github.com/memorax-ai/memorax-code#your-memory-your-control)

本地 Viewer、trace、writeback task projection 和 reconciliation 只提供状态与诊断，不是 Memory、transcript、Session 或 Scope 权威。[Architecture: State classes](https://github.com/memorax-ai/memorax-code/blob/main/ARCHITECTURE.md#62-state-classes-and-shutdown-ownership)

公开仓库没有给出 MemoraX Console 的 revision、Evidence 外键、删除传播或云端垃圾回收实现，因此不能据此证明它具备 VoiceClaw 已决定的 Evidence-aware 重算语义。

## LLM 与 embedding 边界

公开仓库能够证明：

- 本地 Backend 不拥有 Agent 模型执行或模型 Provider 凭证；
- Repo Memory 存在确定性的本地收集和验证；
-选定内容和 Search query 会发送到远端 MemoraX API；
- 配置允许 `raw`、`pre_summarized` 等 Add 形态，并暴露 dense/sparse 检索参数。

公开仓库不能证明：

- 云端 Add 是否一定调用 LLM；
- 使用什么提取、合并或冲突模型；
- 是否生成 embedding、使用什么模型或如何存储；
- Memory 数据库 Schema、租户隔离和精确删除机制。

因此，MemoraX 不是“所有 Memory Producer 都在 Desktop Host”的实现证据。VoiceClaw 的该选择应作为自己的隐私与复杂度决策：Relay 只保存、授权、检索和协调；所有确定性或模型辅助 Producer 以及 embedding 生成都在 Desktop Host；Relay 不向远端 Memory API 转发内容。

## 对 VoiceClaw 的采用建议

### 建议采用

- Provider-specific Integration Plugin 解释原生 Thread/Turn，通用层不解析 Provider 格式；
- 完整 Turn、稳定身份、可信 Scope 和 fail-closed；
- 检索与 Memory Inclusion 分开的权限和开关；
- Conversation idle 后异步、可缓冲、可恢复的 writeback；
- 只传用户输入与最终可见 Semantic Output，排除思考、工具细节和不完整 Turn；
- 有界检索结果、Memory 类型和用户可见影响提示；
- Viewer/Panel 是 Relay 权威的控制面投影，不直接拥有数据。

### 不建议照搬

- 强依赖闭源远端 Memory API；
- 将 Repository Scope 当作完整的用户授权边界；
- 默认保存内容型本地 trace；
- 由外部 Console 独立承担 VoiceClaw 的 Memory 治理；
- 在没有公开证据时假定其云端 LLM、embedding、revision 或删除算法。

## 对当前设计树的影响

MemoraX 支持当前以下决定：

- 官方 Memory Feature Plugin 的 Relay Authority、Desktop Producer、Retrieval 和 UI Contributions 保持深边界，并只通过 Capability Contract 访问 Provider Integration 与 Archive；
- `memoryReadPolicy` 与 `memoryInclusionPolicy` 分开；
- Memory Producer 在后台处理已完成、身份可证明的 Turn；
- Memory Panel 负责查看、纠正、删除、授权和运行状态，但不是权威；
- Agent Memory 与 Conversation Archive、Harness Thread、trace 分开。

它没有提供推翻 Q37:B 的必要证据。VoiceClaw 已确认所有 Producer 仅作为 Memory Feature Plugin 的 Desktop Host Contributions 运行；代价是 Host 离线时 Memory writeback 与 embedding 保持 Memory Production Pending，且 Relay Authority Contribution 必须保存可恢复的 Memory Production Request 和 Evidence 边界。

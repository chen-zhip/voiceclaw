# ChatGPT / Codex 对话历史与跨对话记忆研究

> 日期：2026-09-04
> 范围：只使用 OpenAI 官方公开资料，限定 `learn.chatgpt.com`、`developers.openai.com`、`platform.openai.com`。本文关注对话记录、项目边界、派生记忆、删除语义与 Codex 本地状态，并提炼对 VoiceClaw Relay Conversation Archive 的启示。

## 结论

ChatGPT 与 Codex 公开呈现的模型不是“把所有旧对话拼进新对话”，而是分层保存和使用状态：

1. **Chat / transcript** 保存单次对话的消息与工作目录等会话状态，可恢复原线程。
2. **Project** 组织多个相互独立的 Chat，并为它们提供共享文件、说明和连接来源。
3. **Memory** 是从符合条件的旧 Chat 中提取、后台更新、以后按需注入的派生状态；它不是 transcript 的别名。
4. **附件、执行快照、Memory 和 Chat** 有各自的生命周期。删除 Chat 不代表删除其他类别。

因此，VoiceClaw 如果以“跨对话记忆”为 Relay 的主要价值，Relay Archive 应首先成为可检索、可同步、有来源身份的 transcript 权威；跨对话 Memory 应作为带来源和独立控制的派生层，而不应把 Archive 本身等同于 Memory。

## 公开行为

### 1. Chat 与 Project 是两个层级

OpenAI 建议每个独立结果使用单独 Chat。每个 Chat 保留自己的 transcript；Codex Chat 还记录工作目录，并可以通过 `/resume` 或 `codex resume` 继续。多个 Chat 可以在同一个 Project 中使用共享文件、Project instructions 和连接来源。[Projects and chats](https://learn.chatgpt.com/docs/projects)

Codex CLI 以启动目录或 `--cd` 指定的目录作为 Chat 的项目上下文；IDE 扩展以打开的 folder/workspace 为本地 Project。CLI 和 IDE 并不直接暴露 ChatGPT Web/Desktop 的 Projects 视图。[Projects and chats](https://learn.chatgpt.com/docs/projects)

这说明以下身份不应合并：

- Conversation/Chat ID：一条可恢复的独立 transcript；
- Project/Workspace ID：多个 Chat 共享的长期工作边界；
- Provider Thread ID：某个 Harness 内部用于继续执行的线程身份。

### 2. 跨对话 Memory 是派生层

官方明确区分 ChatGPT Web 的 ChatGPT Memory 与本地 Codex Client 的独立本地 Memory store。Codex 会在启用后，从符合条件的既有 Chat 中提取有用上下文，跳过仍活跃或过短的 Session，清除生成字段中的 Secret，并在 Chat 空闲一段时间后后台更新，而不是在每个 Chat 结束时立即同步。[Memories](https://learn.chatgpt.com/docs/customization/memories)

Codex 的主要本地 Memory 文件位于 `~/.codex/memories/`，包含摘要、持久条目、近期输入和旧 Chat 的支持证据。官方把这些文件描述为 generated state，而不是必须人工维护的权威规则来源。[Memories](https://learn.chatgpt.com/docs/customization/memories)

用户可以按 Chat 独立控制两个方向：

- 当前 Chat 是否可以读取已有 Memory；
- 当前 Chat 是否可以被纳入未来 Memory 的生成流程。

这两个 Chat 级选择不会改变全局设置。Codex 本地 Memory 默认关闭，并分别提供 `memories.generate_memories` 和 `memories.use_memories` 等配置。[Memories](https://learn.chatgpt.com/docs/customization/memories)

#### Memory 的查看、纠正、编辑与删除

限定范围内的官方资料支持以下结论：

| 产品面 | 官方明确的管理方式 | 官方没有公开的内容 |
| --- | --- | --- |
| ChatGPT Web / ChatGPT Work | ChatGPT Memory 从 **Settings > Personalization** 管理；Saved memory 与 Conversation 使用不同的控制和删除生命周期，删除 Conversation 不一定删除既有 Saved memory。[Memories](https://learn.chatgpt.com/docs/customization/memories) [ChatGPT Work cloud security](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-cloud-security#data-handling-and-retention) | 没有在这些资料中说明逐条 Memory 是否可直接改写、用户在 Chat 中提出纠正时如何更新旧事实、是否保留 revision/supersedes 关系，也没有公开 Memory 的数据库或向量结构。 |
| ChatGPT Desktop / Codex TUI 的本地 Codex Memory | `/memories` 控制当前 Chat 是否读取既有 Memory、是否被纳入未来 Memory 的生成流程；全局开关位于 Settings > Personalization。本地文件位于 `~/.codex/memories/`，包含摘要、持久条目、近期输入和支持证据，可以检查，但官方明确不建议把手工编辑文件作为主要控制面。[Memories](https://learn.chatgpt.com/docs/customization/memories) | 没有公开受支持的逐条编辑、逐条删除、纠错合并或 revision API；也没有说明 IDE、TUI 或 Desktop 是否提供完整的 Memory Entry 编辑器。 |
| macOS Computer History Memory | History 面板可以查看摘要、逐项删除或按时间范围清除；清除会同时删除对应事件和由其生成的 Memory。生成结果是位于 `$CODEX_HOME/memories/extensions/skysight/` 的纯文本 Markdown，官方明确说用户可以读取和修改。[Computer History](https://learn.chatgpt.com/docs/customization/computer-history#where-does-computer-history-store-my-data) | 没有说明手工修改后是否重建索引、如何校验 provenance、后台重新生成是否会覆盖修改，或是否保留修订历史。 |

因此不能从官方资料推出“ChatGPT 的方案就是让用户直接编辑一条向量”。官方公开的是产品控制面和生命周期分离；只有 Computer History 明确公开了可读写的本地 Markdown，而 ChatGPT 云端 Saved memory 的字段级编辑方式仍未公开。对 VoiceClaw，更稳妥的借鉴是：用户查看和编辑可读的 `Memory Entry`；纠正时创建新的 User-authored revision 并使旧版本 superseded；检索 embedding 只是可删除、可重新生成的派生索引；删除 Entry 时同时失效其检索索引。这个 revision 与 embedding 方案是 VoiceClaw 的设计决定，不是已公开的 ChatGPT 内部实现。

### 3. Transcript 与可恢复运行状态也不是同一存储

Codex 配置允许用 `history.persistence = "save-all" | "none"` 控制是否把 Session transcript 保存到 `history.jsonl`，并允许通过 `history.max_bytes` 丢弃最旧条目。[Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference)

同一份官方配置参考还提供 `sqlite_home`，用于指定 Codex 保存 SQLite-backed agent jobs 和其他 resumable runtime state 的目录。[Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference)

这只能证明官方产品把 transcript persistence 与 job/runtime resumability 作为不同状态类别处理。公开资料没有说明 `history.jsonl`、SQLite 状态数据库和 UI Recent Chats 之间的完整映射、Schema 或事务协议。

### 4. Archive 与 Delete 不相同

ChatGPT/Codex 的 Archive Chat 是可恢复的组织操作：归档后可以从 Settings 的 Archived chats 恢复；Pin 或 Archive 只改变 UI 组织，不增加上下文，也不改变 ChatGPT 可访问范围。[Projects and chats](https://learn.chatgpt.com/docs/projects)

OpenAI 的 ChatGPT Work 保留说明进一步把 Conversation、Hosted execution state、Library file、Project file、Saved memory、Connected-app copy 和浏览器数据列为不同数据类别：

- 删除 Chat 通常会安排在 30 天内永久删除，但受官方列出的安全、法律和去标识化例外约束；
- 删除 Chat 不会立即清除所有执行状态和快照；
- 删除 Chat 不会删除 Library 中保存的文件；
- 删除 Chat 不一定删除已经形成的 Saved memory；
- 删除 Conversation、删除 Library file、删除 Saved memory、断开 App 和清除浏览器数据是不同操作。

[ChatGPT Work cloud security](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-cloud-security)

这些是公开的产品语义，不足以推出其内部数据库采用软删除还是物理删除，也不足以推出所有 ChatGPT 套餐都使用完全相同的保留期。

## 对 VoiceClaw Relay Archive 的直接启示

### A. 保持四类状态分离

| VoiceClaw 状态 | 建议权威 | 用途 |
| --- | --- | --- |
| Conversation transcript | Relay Conversation Archive | 跨 Client 查看、搜索、恢复和同步原始会话事件 |
| Project / Workspace context | Relay 保存逻辑绑定；Desktop 保存本机路径 | 组织相关 Conversation 和稳定规则/资料 |
| Harness Thread / Turn runtime | Harness 为执行权威；Relay 保存映射与可恢复状态 | 继续原生 Agent 工作、审批、取消和未知结果协调 |
| Derived Memory | 官方或兼容的 Memory Feature Plugin；默认 Producer 作为 Desktop Host Contribution | 从授权 Archive Capability 内容提取、合并并在未来 Conversation 中检索注入 |

活动 Archive Feature Plugin 的 Relay Authority Contribution 可以是 Derived Memory 的来源和 provenance 权威，但 Memory Feature Plugin 只能通过有 Capability Grant 的 Archive Contract 读取内容，不应无条件把完整旧 transcript 注入每个新 Conversation。

### B. 跨对话 Memory 需要双向授权开关

参考 Codex 的 per-chat controls，每个 VoiceClaw Conversation 至少应分别保存：

- `memoryReadPolicy`：该 Conversation 能否消费已有派生 Memory；
- `memoryInclusionPolicy`：该 Conversation 的内容能否成为 Memory Evidence 并进入未来 Memory 的生成或更新流程。

此外仍需要全局/Workspace 级默认值。关闭读取不应自动关闭 Memory Inclusion，反之亦然。

### C. Derived Memory 必须带来源并可重新计算

每条 Derived Memory 应至少记录：

- 生成者 Plugin 与版本；
- 来源 Conversation/Event 的稳定 ID 或查询范围；
- 生成时间、更新时间和提取策略版本；
- 是否包含已删除、已撤销授权或当前不可访问的来源；
- 独立删除/禁用状态。

这样才能在用户删除来源 Chat、撤销 Archive grant、禁用 Provider 或升级提取策略时进行失效、重建或人工确认。

### D. 对首次迁移与 Q16 的影响

升级前已从 Desktop/Mobile SQLite **物理删除且没有 tombstone** 的记录，Relay 无法可靠证明它曾存在。跨对话 Memory 的目标不会改变这一事实；通过 ID 缺口猜测删除会制造错误历史。

建议仍采用：

1. 首次迁移只导入当时仍存在的 Conversation、Message 和附件；
2. 不根据 ID 缺口推断删除，也不伪造 tombstone；
3. 切换后由 Relay 对新删除记录明确 tombstone；
4. 如果本地已存在由旧 Chat 生成的 Memory，则把它作为单独来源类型导入，并标记 provenance 不完整，而不是伪装成可追溯 transcript；
5. 删除 UI 明确区分“删除 Conversation”“删除由它派生的 Memory”“两者都删除”。

### E. 离线 Client 仍不应成为第二历史权威

Codex 的本地存储证明本地 transcript、Memory 和 resumable runtime 可以并存，但官方公开资料没有证明其采用 VoiceClaw 所需的多设备双向冲突合并协议。因此不能据此推导 VoiceClaw 应允许 Client 离线改写 Relay 的既有权威历史。

VoiceClaw 可保留缓存、草稿和 outbox；只有 Relay 接受后才生成正式 Archive Event。Derived Memory 的后台生成可以异步，但必须基于 Relay 已接受且当前授权的 Archive 内容。

## 公开资料没有说明的实现细节

以下事项不能从限定范围内的官方公开资料得出，设计时必须作为 VoiceClaw 自身决策，而不能称为复刻 ChatGPT/Codex：

- ChatGPT 云端 Conversation 和 Memory 的数据库 Schema、索引和检索算法；
- ChatGPT 如何选择哪些 Saved memory 或旧 Chat 内容注入某次推理；
- ChatGPT/Codex 删除 Conversation 后如何逐条失效已派生 Memory；
- Codex `history.jsonl`、SQLite runtime state、Recent Chats 与 Memory evidence 的精确外键关系；
- 多台 Codex Host 是否以及如何合并本地 Memory；
- ChatGPT 客户端的离线缓存、离线写入和冲突解决协议；
- 删除数据在备份、审计或法律保留系统中的内部传播方式。

## 建议决策

对当前 grilling 的 Q16，建议选择原 **A**，并补充一项新架构决定：

> Relay Conversation Archive 是跨 Client transcript 权威；跨对话 Memory 是由授权 producer 从 Archive 派生的、带 provenance 且可独立删除/重建的状态。首次迁移不重建已经缺失的 transcript，也不从 ID 缺口推断历史删除。

这既保留 Relay 的跨对话价值，也避免把“历史记录”“执行线程”和“模型记住的内容”混成一个无法正确删除或审计的数据结构。

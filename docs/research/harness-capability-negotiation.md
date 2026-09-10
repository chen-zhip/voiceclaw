# Harness 动态能力发现与兼容性研究

> 调研日期：2026-08-30
> 范围：Claude Code / Claude Agent SDK 与 Codex App Server。本文只回答 Integration Plugin 能否在运行时发现 Harness 能力，以及仍需哪些版本化适配；不定义具体实现。
>
> 规划更新（2026-09-09）：本文引用的精确 Codex 字段仍是 `rust-v0.150.1` 调研快照；正式 `integrate-codex-provider-prototype` 已选择本机验证的 `codex-cli 0.153.4` 作为首个精确 Capability Profile，并要求实施时提交该版本生成的 schema/版本/SHA-256 证据。两者用途不同，不应把本调研快照误当成原型实现基线。

## 结论

Claude Code 和 Codex 都能动态报告一部分“当前实际可用”的能力，但目前都没有一个足以替代 Integration Plugin 适配知识的通用能力协商协议。

| 判断项                           | Claude Code / Agent SDK                                                   | Codex App Server                                                                   |
| -------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 初始化握手                       | 有。SDK 控制协议初始化，并产生 `system/init` 元数据                       | 有。客户端必须先调用 JSON-RPC `initialize`                                         |
| 协议版本协商                     | 没有通用协议版本协商；`claude_code_version` 只是运行版本信息              | 没有。请求中的 `clientInfo.version` 是客户端版本；响应不返回协议版本               |
| 服务器能力声明                   | 部分支持。Claude Code 2.1.205 起有开放字符串集 `system/init.capabilities` | 没有通用服务器能力集。`initialize.capabilities` 是客户端声明其接受的行为           |
| 运行时资源发现                   | 支持模型、命令、Agent、插件、技能、MCP 状态等                             | 支持模型、Provider 能力、实验特性、权限配置、技能、插件、MCP 状态等                |
| 工具 schema 动态发现             | MCP 工具支持；Claude 内建工具通常只报告名称，schema 仍来自 SDK 静态类型   | App Server 方法 schema 可由当前 CLI 生成；这属于版本绑定的静态检查，不是连接时发现 |
| 是否仍需 Integration Plugin 适配 | 需要，尤其是 Claude 内建工具与未显式声明的行为                            | 需要，尤其是 JSON-RPC 方法/字段、实验 API 与兼容差异                               |

因此，VoiceClaw 不应把“当前 Harness 能否做到某事”简化为 Provider 名称判断，也不应把能力写死在 Relay。每个 Integration Plugin 仍需维护该 Harness 的静态协议知识。基于本调研，项目另行决定以插件内的版本化静态 Capability Profile 作为唯一能力定义；动态信息只描述运行状态和资源清单，不参与能力语义协商。

## 需要区分的四类信息

1. **生命周期握手**：确保客户端和服务端完成初始化，不等于双方协商出共同协议版本。
2. **显式能力声明**：服务端明确声明某个语义能力，例如 Claude 的 `interrupt_receipt_v1`。
3. **运行时资源清单**：当前有哪些模型、工具、插件或 MCP Server；它不能证明未列出的协议行为一定不存在，也不能替代方法 schema。
4. **版本化静态知识**：Integration Plugin 随已知版本维护的方法、字段和语义，或从已安装二进制生成 schema。它不是动态协商，但仍是两套集成不可缺少的兼容层。

## Claude Code / Claude Agent SDK

### 实际支持的动态机制

Claude Code 的流式输出以 `system`/`init` 消息给出本次会话的有效元数据，包括模型、工具、MCP Server、插件等。官方 headless 文档还规定：从 Claude Code 2.1.205 开始，初始化消息可带开放字符串数组 `capabilities`；集成方应按字符串探测能力、忽略未知值，不应通过比较版本号推断能力。官方给出的能力示例包括 `interrupt_receipt_v1` 和 `interrupt_cancel_queued_v1`。[Claude Code：读取会话元数据](https://code.claude.com/docs/en/headless#read-session-metadata)

Agent SDK 在此基础上提供更方便的运行时查询入口：

- TypeScript `Query` 可读取初始化结果，并查询支持的命令、模型、Agent 与 MCP Server 状态；模型信息还包含 effort、adaptive thinking、fast mode 等支持标记。[Agent SDK TypeScript API](https://code.claude.com/docs/en/agent-sdk/typescript)
- Python `ClaudeSDKClient` 提供 `get_server_info()`、`get_mcp_status()` 等方法；官方实现通过控制协议发送 `initialize` 请求并保存初始化结果。[Agent SDK Python API](https://code.claude.com/docs/en/agent-sdk/python)、[Python SDK `client.py`](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/client.py)、[Python SDK `query.py`](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/query.py)

对于 MCP，能力发现更完整。MCP 初始化会交换 `protocolVersion`、实现信息和双方 capability；`tools/list` 返回工具的输入 schema，Server 声明 `tools.listChanged` 后还能发出 `notifications/tools/list_changed`。Claude Code 会自动刷新发生变化的工具、prompt 和 resource。[MCP 生命周期](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)、[MCP Schema](https://modelcontextprotocol.io/specification/2025-06-18/schema)、[Claude Code：动态工具更新](https://code.claude.com/docs/en/mcp#dynamic-tool-updates)

### 不支持或不能据此推断的内容

- `system/init.capabilities` 是开放的、局部的能力字符串集，不是完整协议方法表，也没有协商双方共同协议版本。
- `claude_code_version` 可用于诊断和兼容回退，但官方明确要求优先做 capability detection，不能把版本比较当作主要能力判断。
- `system/init` 中的 Claude 内建工具主要是名称清单；它不等同于 MCP 的 `tools/list`，不能据此动态获得每个内建工具的完整输入/输出 schema。内建工具 schema 仍需依赖 Agent SDK 类型或 Integration Plugin 的版本化映射。
- Python `get_server_info()` 的部分服务器信息是宽泛字典类型；存在字段不代表其形成了稳定、通用的能力协商契约。
- Claude 插件 manifest 没有通用的 `requiresClaudeCode` 或“宿主必须具备哪些能力”字段。`version` 用于插件更新/缓存，`dependencies` 表示插件间 semver 依赖；未知顶层字段会被忽略，不能自造字段期待宿主执行兼容检查。[Claude Code 插件 manifest](https://code.claude.com/docs/en/plugins-reference#plugin-manifest-schema)

### 版本注意事项

- `system/init.capabilities` 仅保证在 Claude Code 2.1.205 及以上出现；旧版本缺失该字段时必须回退，不能把缺失解释成任意能力均受支持。[Claude Code：读取会话元数据](https://code.claude.com/docs/en/headless#read-session-metadata)
- Claude Code 2.1.214 之前，MCP 动态刷新时的短暂工具错误行为不同；集成不能只判断 MCP 是否支持 `list_changed`，还应把异常作为可恢复刷新处理。[Claude Code：动态工具更新](https://code.claude.com/docs/en/mcp#dynamic-tool-updates)
- SDK 暴露面和随包携带的类型可能落后或领先于用户安装的 Claude Code，因此判断当次运行状态时应以当前会话初始化结果和原生探测为准；VoiceClaw 的能力语义仍以 Integration Plugin 的静态 Capability Profile 为准。

## Codex App Server

### 实际支持的动态机制

Codex App Server 是长驻子进程上的双向 JSON-RPC 接口；官方建议本地客户端启动进程并通过 stdio 维持连接。[OpenAI：Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness/)

客户端必须先调用 `initialize`。在当前官方协议中，请求包含 `clientInfo` 以及可选的客户端 capability，例如 `experimentalApi`、attestation、通知退订和 MCP 扩展；这些字段表达“客户端愿意或能够接受什么”。服务端 `InitializeResponse` 只含 `userAgent`、`codexHome`、`platformFamily`、`platformOs`，不包含 `protocolVersion`、服务端版本字段或通用 server-capabilities 集。[Codex App Server v0.150.1 协议定义](https://github.com/openai/codex/blob/rust-v0.150.1/codex-rs/app-server-protocol/src/protocol/v1.rs)

初始化后可以动态查询部分当前资源和特性：

- `model/list`：当前模型目录以及 reasoning effort、输入模态、personality、multi-agent 版本和 tier 等模型属性。
- `modelProvider/capabilities/read`：当前 Provider 的窄能力集；在 v0.150.1 类型中为 `namespaceTools`、`imageGeneration`、`webSearch`。
- `experimentalFeature/list`：实验特性的名称、阶段、当前/默认启用状态，以及可选的线程上下文配置。
- 权限配置、技能、插件、hook、MCP 等接口可报告各自资源或状态，但它们不是完整 JSON-RPC 方法表。

上述接口与生成 schema 的官方命令记录在 App Server README；模型和 Provider 能力的精确类型见协议源码。[Codex App Server v0.150.1 README](https://github.com/openai/codex/blob/rust-v0.150.1/codex-rs/app-server/README.md)、[Codex App Server v0.150.1 模型协议类型](https://github.com/openai/codex/blob/rust-v0.150.1/codex-rs/app-server-protocol/src/protocol/v2/model.rs)

### 不支持或不能据此推断的内容

- `initialize` 是生命周期握手，不是协议版本协商。`clientInfo.version` 是客户端自报版本；服务端不会返回“双方最终选择的协议版本”。
- `initialize.capabilities.experimentalApi` 只是客户端对实验接口的显式 opt-in。它不会告诉客户端有哪些实验方法或字段；客户端仍需先从对应版本 schema 获得静态知识。未 opt-in 时调用实验成员会收到“需要 experimentalApi capability”一类错误。[Codex App Server README：Experimental API opt-in](https://github.com/openai/codex/blob/rust-v0.150.1/codex-rs/app-server/README.md#experimental-api-opt-in)
- `modelProvider/capabilities/read` 只描述几个 Provider 层特性，不能证明流式事件、取消、审批、回滚、历史恢复等 App Server 协议行为。
- `userAgent` 当前包含二进制构建版本，但它不是规范化的协议版本/兼容性字段，不应作为唯一判断依据。[Codex user agent 源码](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/default_client.rs)
- App Server 没有运行时 `methods/list` 或等价的通用 feature-discovery 接口。未知方法错误只能用于降级，不能替代事先的 schema 适配。

### 版本化 schema 是关键补充

官方 CLI 可对**当前安装的 Codex 二进制**执行 `codex app-server generate-json-schema` 或 `generate-ts`。官方说明生成结果与执行命令的该版本 App Server 匹配。这能可靠回答某个版本是否定义了某方法/字段，但它发生在安装或更新时，属于版本绑定的静态检查，不是连接时动态协商。[Codex App Server v0.150.1 README](https://github.com/openai/codex/blob/rust-v0.150.1/codex-rs/app-server/README.md)

本文关于精确字段的判断固定在 `rust-v0.150.1` 源码。后续 Codex 版本可能新增字段或 discovery 方法，因此 Integration Plugin 更新时必须重新生成和校验 schema，不能把本文列出的字段视为永久全集。

## VoiceClaw 采用的能力判断顺序

调研之后，项目选择用可审查的静态适配换取更低的系统复杂度。规范顺序如下：

1. 根据 `providerId` 找到已安装且启用的 Integration Plugin；Relay、Desktop Host 和 Client 均不得按 Provider 名称分支。
2. Integration Plugin 识别 Harness 版本，并选择插件内硬编码、版本化的 Capability Profile。
3. 有精确匹配时使用精确画像；没有精确匹配时使用最近的已知画像，并向用户持续显示“版本未经验证”警告。
4. 画像是 VoiceClaw 能力语义的唯一来源。审批、只读、取消、回滚、恢复等安全和一致性能力同样不做动态协商。
5. 原生初始化、模型/MCP/工具清单等动态信息只用于 Provider Availability、会话健康和运行时资源展示，不能添加、删除或改变画像中的能力。
6. 调用发生协议或语义错误时，将当前 Provider 会话标记为 degraded，保留输入与会话，并让用户显式重试、换 Provider 或返回 S2S；不得静默切换执行器。

该策略明确接受一个兼容性风险：未知 Harness 版本会把最近画像的全部能力暂时视为可用，错误可能延迟到调用时才暴露。风险由持续警告、degraded 状态和显式回退控制；插件维护者仍应通过版本化 schema 与官方资料及时发布新画像。

## VoiceClaw 能力画像的维护证据

| VoiceClaw 能力             | Claude 画像维护证据                                 | Codex 画像维护证据                                             | Integration Plugin 要求         |
| -------------------------- | --------------------------------------------------- | -------------------------------------------------------------- | ------------------------------- |
| 流式事件                   | SDK 消息类型 + 当前 init                            | 当前版本 App Server schema + 实际事件                          | Integration Plugin 维护事件映射 |
| 中断/取消确认              | `system/init.capabilities` 对应字符串               | 当前版本 schema 与行为验证                                     | 按已验证版本硬编码语义          |
| 模型/推理档位              | `supportedModels()` 和模型能力字段                  | `model/list`                                                   | 已验证版本映射                  |
| 内建工具                   | init 名称清单 + SDK 静态 Tool 类型                  | 当前版本 schema/相关资源接口                                   | 必须保留版本化适配              |
| MCP 工具                   | MCP `initialize` + `tools/list` + `list_changed`    | MCP 状态/协议清单与当前 schema                                 | MCP 协议版本兼容处理            |
| Provider 特性              | 模型/运行时信息；不存在统一 Provider capability API | `modelProvider/capabilities/read`                              | 只使用明确返回的窄能力，不外推  |
| 实验功能                   | 明确 capability 或 SDK 字段                         | `experimentalApi` opt-in + `experimentalFeature/list` + schema | 默认关闭，逐项允许              |
| 审批、只读、回滚、会话恢复 | 对应 SDK/API 与版本资料                             | 对应 schema/API 与版本资料                                     | 画像必须逐项明确声明            |

## 对职责边界的直接结论

- **Integration Plugin** 持有 Harness 专属的协议、版本、schema 和唯一 Capability Profile，并采集原生运行状态。
- **Desktop Host** 根据 Capability Profile 提供本机 Provider 生命周期和工作区绑定，不复制 Claude/Codex 版本判断。
- **Relay** 转发归一化画像与 Provider Availability，但不得按 `claude`、`codex` 或 Provider 名称硬编码能力。
- **Client** 根据画像展示、隐藏或禁用入口，不自行推断后端是否支持。

即便未来 Claude 或 Codex 增加更完整的动态协商，是否改变上述策略也必须作为新的架构决策处理，不能由某个 Integration Plugin 静默改变全局能力语义。

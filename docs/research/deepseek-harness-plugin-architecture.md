# DeepSeek Harness 插件架构及其对 VoiceClaw Memory 的启示

> 调研日期：2026-09-08
> 来源范围：只使用 DeepSeek 官方网站与 `deepseek-ai/deepseek-harness` 官方仓库中的架构文档、开发文档、包说明和源码索引。未使用社区插件、第三方文章或社区讨论作为事实依据。

## 结论摘要

“DeepSeek Harness”最可信且名称完全匹配的对象，是 DeepSeek 官方仓库 [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)。DeepSeek 官方产品页也直接把该仓库作为 Harness 的源码入口，因此目前没有实质性的同名项目歧义。[来源：DeepSeek Harness 官方页](https://www.deepseek.com/harness/en/)

DeepSeek Harness 值得 VoiceClaw 借鉴的核心不是“每个功能必须只有一个插件包”，而是以下组合模型：

1. 一个很小的插件运行时提供生命周期、服务、事件和配置组合机制；
2. 产品能力以稳定的能力接口连接可替换 Provider 和多个 Consumer；
3. 一个可安装 Bundle 可以一次装配多个插件和配置行，对用户仍表现为一个功能；
4. 后端能力与 UI 都通过显式扩展点贡献，不要求修改中心循环或页面外壳；
5. 插件卸载时，其注册、监听器及资源会按生命周期撤销。

对 VoiceClaw 而言，后续已确认采用 VoiceClaw Plugin Package 作为交付物、Feature Plugin 作为用户管理的逻辑功能、Contribution 作为运行时实现、Capability Contract 作为解耦边界。Memory 因而是一个官方 Memory Feature Plugin，其包内拆分 Relay Authority、Desktop Memory Producer、检索/Embedding、Desktop/Mobile UI 等 Contributions，而不是把跨 Relay、Desktop、Mobile 的所有实现压进单一进程内插件。框架内只保留稳定合同和不可绕过的安全不变量。

但 DeepSeek Harness 的进程内共享 Context 模型不宜原样照搬。VoiceClaw 支持独立 Relay、远程 Desktop Host、跨设备 Client，并已有明确的 Archive/Memory 权限与删除要求；第三方插件应通过显式 capability grant 和受控 RPC/Host transport 访问能力，不能默认获得 Relay 数据库、凭据或完整 Archive 的进程内权限。

## 证据标记

- **[可证实]**：官方页面、官方文档或官方仓库当前内容直接说明。
- **[推断]**：根据多个第一方事实推导出的 VoiceClaw 设计建议，不表示 DeepSeek 官方采用了该设计。
- **[未知]**：第一方资料没有给出足够信息，不能当成既定事实。

## 一、项目辨认与歧义

### [可证实] 最可信对象就是 DeepSeek 官方 Harness

DeepSeek 官方产品页使用“DeepSeek Harness developer preview: Everything is a plugin”，并链接至 `deepseek-ai/deepseek-harness`；官方 GitHub 组织也把该仓库描述为 “DeepSeek Harness: Everything is a Plugin”。[来源：DeepSeek 官方产品页](https://www.deepseek.com/harness/en/)，[来源：官方 GitHub 仓库](https://github.com/deepseek-ai/deepseek-harness)

该产品仍处于 developer preview，官方说明 Core plugins 与 APIs 会继续演进。因此本文提炼的是架构模式，不建议把当前 `master` 的具体 API 名称直接固化为 VoiceClaw 长期合同。[来源：DeepSeek 官方产品页](https://www.deepseek.com/harness/en/)

### [未知] 用户是否还特指某个演示模式或分支

用户的描述与官方项目整体架构完全吻合，当前无须采用其他候选。但 DeepSeek 官方还提供 Creator、Web、Headless、SDK、ACP 等不同 Profile；如果用户指的是某一段特定演示或某个尚未发布分支，其更细的装配行为仍需提供链接后再核对。[来源：官方架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)，[来源：官方产品页](https://www.deepseek.com/harness/en/)

## 二、核心与插件边界

### [可证实] “所有产品部件都是插件”，包括通常会被当作 Core 的部分

官方架构文档明确说明：模型 Adapter、工具 Registry、Session Log、Agent Loop 都是 Cordis 插件，并可从配置替换；扩展行为应挂载新插件，而不是修改一个特权 Core。官方产品页把 models、tools、skills、sessions、sandboxes、storage、loops、scheduling 和 UI 都列为插件提供的能力。[来源：官方架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)，[来源：DeepSeek 官方产品页](https://www.deepseek.com/harness/en/)

这里的“没有特权 Core”不等于没有公共基础设施。Cordis 仍提供 Context、Fiber、Service、Event、Effect 和 Loader；DeepSeek Harness 的 `core/*` 包仍定义 Session、Prompt、Tools、Agent 和默认 Agent Loop 等产品 API spine。区别在于这些基础设施本身也由 Loader 组合，而不是写死成不可替换单体。[来源：Cordis Primer](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md)，[来源：Core 子系统说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md)

### [可证实] 可替换能力采用 Definition / Provider / Consumer 三角色

官方把一个完整 capability seam 分为：

- Service Definition：稳定接口、请求/结果类型与错误语义；
- Service Provider：具体实现；
- Consumer：使用能力的入口，例如模型工具、命令或 UI。

Provider 与 Consumer 都只依赖 Definition，不互相依赖；因此替换文件系统、搜索、压缩或其他 Provider 时，不必修改 Consumer。官方也明确提醒不要为了形式提前拆包，只有角色确实需要独立演进或替换时才拆分。[来源：官方架构文档的 Capability seams](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)，[来源：官方三角色能力设计教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/practice/index.md)，[来源：官方 Packages 约束](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/README.md)

### [可证实] Bundle 是用户侧“一项功能”和内部多插件之间的装配层

一个运行实例是由有序配置层组成的插件树。Profile 是命名组合；Bundle 在 `package.json` 的 `dsh.bundle` 中声明 patch 文件，并通过 patch 向树中加入或替换多个配置行。上层 Profile/Home/CLI overlay 仍可修改 Bundle 插入的配置。[来源：官方架构文档的 Profiles and bundles](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)

这意味着“一项可安装功能”并不要求等于“一个运行时插件实例”。一个 Bundle 可以组合 Definition、Provider、Consumer、策略和 UI 插件，同时给用户一个安装/启用入口。

### [已确认的 VoiceClaw 决策] 采用“可信 Kernel + Feature Plugin”，而不是复制“无 Core”口号

VoiceClaw 已于 2026-09-08 确认：独立 Relay 边界、Desktop Host、Mobile/Desktop Client 和跨边界权限不允许任意插件替换身份验证、授权、fencing 或删除提交点。采用方式是：

- 框架 Core 只保留插件运行时、版本化消息合同、生命周期、配置、权限代理、审计和隔离机制；
- 产品功能由 Bundle 装配；
- 可以替换实现，但不能绕过由 Core 执行的安全不变量。

## 三、插件生命周期、注册、发现、配置与权限

### 生命周期

#### [可证实] Fiber 管理插件实例，Effect 管理可逆副作用

每个插件实例由一个 Fiber 表示，状态为 `PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED`，加载失败进入 `FAILED`。配置编辑、热重载、显式 disposal 或必需 Service 消失都可触发卸载；Cordis API 注册的监听器、子插件和 Service 会自动撤销，外部资源需包在 `ctx.effect()` 中并返回 disposer。[来源：Lifecycle and Effects 教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/02-lifecycle-and-effects.md)

#### [可证实] 依赖以 Service 可用性表达，而不是手工启动顺序

插件通过 `inject` 声明必需 Service。Service 未就绪时插件停留在 `PENDING`；Service 被卸载时依赖插件也会卸载，并在 Service 恢复后重新加载。这使 Provider 热替换时 Consumer 能随之安全重启。[来源：Services 教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/03-services.md)

### 注册与扩展点

#### [可证实] Service 和 Typed Event 是主要插件间合同

插件通过稳定的 `ctx.<service>` 名称消费能力，而不是导入具体 Provider；Typed Event 支持 observe、waterfall、parallel、serial 和 bail 等不同组合语义。工具、Prompt section、Adapter、Provider 和监听器的注册都遵守 Effect 生命周期。[来源：Cordis Primer](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md)

#### [可证实] 领域扩展应选拥有者明确的扩展点

官方架构把常见扩展映射到稳定机制：模型注册到 `ctx.llm`，模型工具注册到 `ctx.tools`，后台工作注册到 `ctx.jobs`，请求拦截使用 `agent/*` 或 `tools/*` Event，模型可见上下文使用 `agent.inject()`，持久 Session 状态扩展 `SessionEventMap`，UI 通过 Agent/Event 与 Client Slot 扩展。[来源：官方架构文档 Where new behavior goes](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)，[来源：Extension Cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/extension-cookbook.md)

#### [可证实] UI 也采用插件与 Slot，而非跨包组件导入

Web Client 的功能由客户端插件组成。插件使用 `ctx.slots.register()` 向已声明 Slot 贡献 UI；Slot 的声明、授权和生命周期相连，插件卸载会移除其贡献。官方规则禁止通过随意跨包导入组件来绕开 Slot/Service 合同。[来源：Client 包地图](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/README.md)，[来源：Client 插件规则](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)

### 发现、安装与配置

#### [可证实] npm/pnpm 负责包安装，manifest + patch 负责 Bundle 发现

`dsh plugin --profile <name> ...` 把命令转交给 Profile 目录中的 pnpm。安装后，CLI 检查依赖包 manifest 的 `dsh.bundle.patch` 声明并同步 Profile 的 Bundle 列表；添加、删除或升级 Bundle 后需重启 Profile，普通 Profile/Home patch 修改可以热重载。[来源：CLI Plugin management](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)

#### [可证实] 配置由多层组合，可检查最终插件树

Bundle、Profile patch、Home patch 和命令行 patch 按顺序组合。`--dump-config` 可以输出实际启动树及配置来源；配置行可按 id 整体替换或插入。[来源：官方架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)，[来源：CLI 配置说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)

#### [可证实] 插件配置有声明类型与运行时 Schema

官方生成 Config Catalog，列出每个可加载包的声明配置、必需 Service 和源码位置，并交叉检查 Loader 接受的 Schema 字段与 TypeScript 声明，降低文档、类型和运行时配置漂移。[来源：官方 Config Catalog](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/config-catalog.md)

### 权限与信任边界

#### [可证实] Harness 有执行权限机制，但它面向 Agent/Tool 操作

官方资料描述了 Session 级 sandbox mode、approval policy、per-agent tool restriction 和模型工具执行前的 policy waterfall。`ctx.tools.restrict()` 还明确被描述为可见性组合，不是独立的安全边界。[来源：Tools README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/README.md)，[来源：Sandbox 设计记录](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-07-06-sandbox.md)

#### [未知] 第一方资料未给出第三方插件的最小权限 Manifest 或进程隔离保证

本次检查的官方安装、架构、生命周期和权限资料中，没有找到类似“插件只获准访问 Archive Search、Memory Write 或某组 Secret”的安装时 capability manifest，也没有找到所有第三方插件默认独立进程运行的保证。官方架构反而表明插件共享 Cordis Context 中的 Service graph，按 `inject` 获得所需 Service；`inject` 解决可用性和生命周期依赖，不等同于用户授权。

因此不能把 DeepSeek Harness 的 `inject` 或 Tool sandbox 直接解释成 VoiceClaw 所需的插件数据权限隔离。是否存在尚未被这些公开文档覆盖的新安全层，属于未知。

#### [推断] VoiceClaw 应把安装信任与运行授权设计成显式框架能力

VoiceClaw 插件至少需要：签名/来源与版本信息、声明 capability、用户授权、最小权限 token、作用域化数据访问、调用审计、撤销、资源预算和故障隔离。尤其是 Archive、Memory、Provider credential 和工作区文件，不能仅靠“插件知道某个 Service 名”进行访问控制。

## 四、Memory 或上下文模块如何接入

### [可证实] 官方包地图当前没有第一方长期 Memory 能力族

官方 Packages 地图列出了 Session、Session Query、Context、Compaction、Goal、Skill 等能力族，但未列出长期 Memory 包组或 `ctx.memory` Service。[来源：官方 Packages 地图](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/README.md)

这只能证明当前公开包地图没有该一等能力，不能证明未来不会加入，也不能把社区 Memory 插件当作官方设计。

### [可证实] 已有的相邻能力可以组成 Memory 插件，但不等同于 Memory

- Session 是 append-only 事件日志及其持久化/Projection 数据面；[来源：Session 包地图](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/README.md)
- Session Query 提供完整日志读取、有界事件窗口、关系追踪和可替换的全文搜索后端；[来源：Session Query README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session-query/session-query/README.md)
- Context 插件可以在每次请求加入模型可见上下文，官方实现会把注入内容作为 user-role 消息写入 Session history，以便重放和压缩；[来源：Context 包地图](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/README.md)
- Tool Registry 可让插件注册模型可调用的读取/修改工具，并自动加入 Prompt assembly；[来源：Tools README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/README.md)
- UI Slot 可增加 Memory 管理面板、会话开关和披露标记。[来源：Client 插件规则](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)

### [推断] 按 DeepSeek Harness 模式实现 Memory，应拆成一个 Bundle 中的多个角色

如果在 DeepSeek Harness 中补长期 Memory，合理结构会是：Memory Service Definition、一个或多个存储/检索 Provider、模型工具或自动 Context Consumer、生产/提炼策略插件，以及 UI 插件。一个 Bundle 决定默认组合，Profile patch 决定启用、替换或禁用哪些角色。

这种结构比“Memory 插件直接导入 Session SQLite、Agent Loop 和 UI 内部组件”更符合官方的 Service/Provider/Consumer、Event、Effect 和 Slot 模型。

### [已确认的 VoiceClaw 方向] VoiceClaw Memory 的对应拆分

“Memory 是插件”正式表示用户可感知的 Feature Plugin 安装与启用单位，而不是单一二进制或单一进程对象：

| 角色 | 建议职责 | 是否可替换 |
|---|---|---|
| Memory Capability Contract | 版本化 Entry、Scope、Evidence、Decision Context、Production、Retrieval、管理和删除请求/结果；不实现业务 | 稳定接口，谨慎演进 |
| Relay Memory Authority Provider | Entry/revision、Scope、策略、grant、候选验证、suppression、审计、两阶段删除提交点 | 可提供替代实现，但必须通过 Kernel 权限代理并满足一致性测试 |
| Desktop Memory Producer Provider | 从授权 Evidence 产生 create/revise Candidate，可确定性或模型辅助 | 可替换、多实现可选 |
| Retrieval Provider | FTS、向量检索、混合排序、Embedding 版本与重建 | 可替换、可组合 |
| Memory Context Consumer | 在 Conversation 开始或步骤前按预算取回 Memory，生成有来源的最小上下文投影 | 可配置/替换；不能绕过 read policy |
| Memory Management UI Consumer | Desktop 完整面板、Mobile 核心控制、Conversation 级开关和披露 | 按 Client 平台分别贡献 |
| Memory Plugin Package / Feature Plugin | Manifest 声明默认 Contributions、Capability Contracts 与配置，作为用户安装、启用和升级的一个功能 | 可有官方默认实现和兼容的替代实现 |

跨 Relay、Desktop Host、Desktop UI、Mobile UI 的 VoiceClaw Plugin Package 通过同一 Plugin Manifest 描述其多运行时 Contributions；各 Contribution 仍在自己的信任域加载，不应把 Relay 代码下载后交给 Mobile 执行，也不应把 Desktop Producer 当成 Relay 内进程插件。

### [已确认的 VoiceClaw 决策] Kernel 必须保留不可旁路的 Memory 安全闸门

Memory 功能可插拔，不代表以下不变量也交给任意 Provider 自行选择：

- `memoryReadPolicy`、`memoryInclusionPolicy`、Memory Scope 和 named grant 的最终授权；
- Archive Access Grant 与原始 Evidence 的受控读取；
- Active Memory Host Assignment、generation fencing 和 late result rejection；
- Candidate Schema/大小/当前 revision/删除状态验证；
- 同步移除可读内容和检索资格、建立 Memory Suppression、再异步 purge；
- 内容最小化、审计、撤销和私有推理排除。

这些可由框架级 Policy/Authority Service 执行，默认 Memory Provider 通过它们工作。即使用户替换 Producer、Embedding 或检索排序，插件也不能拿到越权数据或提交已被删除/撤销的结果。

## 五、可借鉴与不宜照搬

### 可借鉴

1. **[可证实 → 推断] 用 Bundle 表达完整功能。** DeepSeek Harness 用 Bundle 安装多配置行，适合 VoiceClaw 把 Memory 作为一个可安装功能、内部按运行时和角色拆分。[来源：官方架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
2. **[可证实 → 推断] 稳定 Definition，替换 Provider，分离 Consumer。** 这能让 Memory 存储、Producer、Embedding、检索、自动注入、显式搜索和 UI 各自演进。[来源：官方三角色能力设计教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/practice/index.md)
3. **[可证实 → 推断] 注册必须绑定插件生命周期。** 插件卸载后，定时生产、事件监听、UI、检索 Provider 和 Host transport 都应自动撤销并完成 drain。[来源：Lifecycle and Effects 教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/02-lifecycle-and-effects.md)
4. **[可证实 → 推断] 用依赖可用性驱动加载。** Producer Consumer 在 Authority/Host transport 不可用时保持未激活或 degraded，而不是部分运行。[来源：Services 教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/03-services.md)
5. **[可证实 → 推断] 后端、策略、模型入口和 UI 使用各自扩展点。** 避免 Memory 模块跨层导入数据库、Agent Loop 和页面组件。[来源：官方架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)，[来源：Client 插件规则](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)
6. **[可证实 → 推断] 配置可检查、可覆盖。** VoiceClaw 应提供有效插件图、配置来源、版本和权限差异视图，类似 `--dump-config`，以支持深度定制和故障排查。[来源：CLI 配置说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)

### 不宜照搬

1. **不要把共享进程 Context 当作权限边界。** DeepSeek 的 `inject` 主要表达依赖与生命周期；VoiceClaw 需要数据级 grant 和跨边界鉴权。
2. **不要让任意第三方插件在 Relay 内以同等权限运行。** Relay 掌握 Archive、Memory、配对身份与删除提交点，默认应隔离不受信任扩展；远程/第三方实现优先走受控 RPC、worker 或独立进程。
3. **不要把 Memory 检索内容无条件复制进 Archive。** DeepSeek Context 插件把模型可见上下文写入 Session Log 以保证可重放；VoiceClaw 已决定 Agent Memory 与 Conversation Archive 分层。更合适的是只在 Archive/审计中记录受限的 Memory 使用引用或披露状态，Memory 正文仍由 Memory Authority 管理，并按原有授权读取。
4. **不要照搬 DeepSeek 对 reasoning 的日志选择。** DeepSeek 官方页将 reasoning 列入可追踪 Session Log；VoiceClaw 已明确排除模型私有 Chain of Thought，只允许可见 Semantic Output 和受限 Outcome Evidence 进入 Archive/Memory 流程。[来源：DeepSeek 官方产品页](https://www.deepseek.com/harness/en/)
5. **不要允许 Bundle patch 覆盖不可变安全底线。** VoiceClaw 的用户配置可替换实现与策略默认值，但不能关闭身份校验、权限审计、generation fencing、删除 suppression 或 late-commit rejection。
6. **不要为了“插件化”拆成无数无价值包。** DeepSeek 官方同样说明只有角色确需独立演进时才拆分；简单 Consumer 可以与其策略实现同包。[来源：官方三角色能力设计教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/practice/index.md)

## 六、对 VoiceClaw 现有规划的直接影响

### [已确认并落盘] ADR-0001 已由通用 Feature Plugin 决策扩展，且不复用 Integration Plugin 名称

VoiceClaw 当前 ADR-0001 将 `VoiceClaw Integration Plugin` 限定为 Harness Provider 的协议、版本、能力画像、配置与翻译层，而 Agent 能力优先进入 Harness Plugin。Memory 是跨 Conversation、Relay、Desktop Host 和 Client 的 VoiceClaw 产品能力，不是 Provider 协议适配；把它叫 Integration Plugin 会破坏现有术语边界。

项目已新增 ADR-0009 并通过 domain-modeling 确认 `VoiceClaw Plugin Package`、`Feature Plugin`、`Contribution` 与 `Capability Contract`。`VoiceClaw Integration Plugin` 继续只表示作为 `provider-integration` Contribution 的 Provider 集成；`Harness Plugin` 继续表示可脱离 VoiceClaw 运行的外部 Harness 原生扩展。

### [已确认] `establish-relay-agent-memory` 的目标改为“定义并交付默认 Memory Feature Plugin”

现有需求语义可以保持：Relay 权威、Desktop-only Producer、独立 Host Assignment、Memory Inclusion、Decision Context、统一面板、两阶段删除等都不与插件化冲突。需要改变的是交付结构：

- proposal 明确 Memory 是可安装/禁用/替换的 Feature Plugin；
- specs 分开规定 framework-level Memory Capability Contract 与默认官方插件行为；
- design 给出 Relay/Desktop/Mobile Contributions、Plugin Manifest、生命周期和权限清单；
- 默认官方实现只是一个符合合同的 VoiceClaw Plugin Package，而不是 Kernel 中唯一硬编码实现；
- 对“不安装 Memory Feature Plugin”定义清楚：Conversation Archive 和普通对话仍可工作，Memory UI/Producer/retrieval 不出现，旧的 transcript-to-Brain `remember` 清理逻辑不得偷偷充当回退。

### [已确认的 VoiceClaw 方向] 安装与运行图

```text
VoiceClaw Kernel
  ├─ versioned contracts + lifecycle + config
  ├─ capability grants + audit + isolation
  └─ multi-runtime Plugin Manifest

Memory Plugin Package / Feature Plugin
  ├─ Relay contribution
  │    ├─ Memory Authority Provider
  │    ├─ policy/grant/suppression/delete gates
  │    └─ retrieval/index providers
  ├─ Desktop Host contribution
  │    ├─ Memory Producer Provider(s)
  │    └─ Embedding Provider(s)
  ├─ Desktop Client contribution
  │    └─ full management UI + conversation controls
  └─ Mobile Client contribution
       └─ core view/correction/delete/policy UI
```

Feature Plugin 是一个用户可管理的功能；各 Contribution 是具体运行时中的实现模块；Capability Contract 和可信 Kernel 是所有实现必须遵守的框架边界。

## 七、进入正式 OpenSpec 前仍需确认

以下问题不能从 DeepSeek Harness 直接抄出答案，仍需 VoiceClaw 在 Kernel change 中决定：

1. Plugin Manifest 的精确字段、ID 规则和一个包可声明的 Feature Plugin 数量；
2. phase 1 是否只允许官方/本地受信插件，何时支持第三方签名、市场和自动更新；
3. Relay Contribution 采用受限进程内模块、worker、WASM 还是独立进程/RPC；
4. Capability Grant 的操作粒度、委派和资源预算；
5. 插件停用/卸载时数据是保留、导出、冻结还是删除，重新安装如何恢复；
6. 跨设备升级、schema migration、回滚、Contribution 版本不一致及离线 Client 的兼容策略；
7. UI Slot 目录、Mobile 可执行代码限制和统一管理面板行为。

## 最终判断

DeepSeek Harness 与已确认方向高度一致：VoiceClaw 将成为通过 Feature Plugin 与 Contributions 组合产品的 Harness-neutral 框架，Memory 是首批验证这种架构的官方 Feature Plugin。

不过应借鉴其可替换能力、Bundle、生命周期、配置和 UI Slot 思想，不应直接照搬其共享进程信任模型。VoiceClaw 的差异化价值恰恰是：在 Relay、Desktop Host 和多 Client 的分布式环境中，仍能让功能深度可插拔，同时保持权限、权威、删除、审计和 fencing 不可旁路。

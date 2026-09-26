## 1. 执行准备

本轮仅完成规划，以下全部待执行。用户已于 2026-09-21 确认公开测试入口：文本面板组件的可见内容，以及 ChatPage 的模式切换、流式输出和滚动行为。以下命令均从仓库根目录运行；测试文件为计划新增路径。

每个实现任务开始前独立调用 `$tdd`，先运行该任务的 RED 命令并确认行为失败，再做最小 GREEN 并重跑同一命令。若现有行为已经 GREEN，记录既有证据，不伪造 RED；只对新增缺失行为开展循环。模块导入失败、测试环境缺失不能算行为 RED。任务内重构放在 GREEN 之后，重构后再次验证。

- [x] 1.1 记录相关文件的已有工作区 diff，与 design.md 固定比较点共同保存为评审输入；核对 proposal、design、spec 一致且严格校验通过。验证：`openspec validate replace-stt-tts-assistant-bubbles-with-output-panel --strict`，并检查基线记录未将已有改动归入本变更。
- [x] 1.2 准备局部 DOM 测试环境：添加必要开发依赖、扩展 `.test.tsx` 收集，UI 测试文件单独启用 jsdom；建立 Electron IPC、WebSocket、媒体、剪贴板边界 fixture。验证：`yarn workspace voiceclaw-desktop test src/renderer/src/lib/use-realtime.test.ts` 仍在原环境通过，新 UI 用例可被发现且能挂载真实组件。本项为测试设施准备，不宣称产品行为的 RED/GREEN。

## 2. 面板与模式选择

- [x] 2.1 实现完成回复的面板正文展示。已确认入口：面板组件可见输出。RED：`yarn workspace voiceclaw-desktop test src/renderer/src/components/AssistantOutputPanel.test.tsx -t "renders completed assistant text"`；预期失败：已有气泡展示无法提供命名的 AI 输出区域及保留段落的面板正文。最小 GREEN：提供可访问名称的输出区域、完整正文、轮次留白和全宽无气泡样式。验证：同一命令通过；真实宽度和换行在 4.2 验收。
- [x] 2.2 在空闲 ChatPage 按已选模式展示历史回复。已确认入口：ChatPage 的可见历史和模式切换。RED：`yarn workspace voiceclaw-desktop test src/renderer/src/pages/ChatPage.output-panel.test.tsx -t "selects idle transcript presentation"`；预期失败：选择 STT/TTS 后历史 AI 仍全部走气泡。最小 GREEN：进入页面读取模式并按角色分派；历史无模式元数据也能展示；切回 Direct/Operator/Supervisor 恢复原展示，用户与工具保留位置。验证：同一命令通过且时间线文本顺序不变。
- [x] 2.3 锁定活动会话的展示模式。已确认入口：ChatPage 模式切换。RED：`yarn workspace voiceclaw-desktop test src/renderer/src/pages/ChatPage.output-panel.test.tsx -t "retains session presentation"`；预期失败：保存设置改变时活动会话的面板被切换。最小 GREEN：两条启动路径保存实际模式，连接及重连使用快照，结束后恢复空闲选择，忽略过期设置读取。验证：同一命令覆盖语音和 typed-input 启动，以及连接、活动、重连、终止阶段。

## 3. 实时输出和阅读交互

- [x] 3.1 统一流式文字到完成回复的交接。已确认入口：ChatPage 可见流式输出。RED：`yarn workspace voiceclaw-desktop test src/renderer/src/pages/ChatPage.output-panel.test.tsx -t "finalizes streamed panel text once"`；预期失败：流式正文仍为气泡，或完成事件与历史加载后重复显示。最小 GREEN：使用同一面板正文表达，保留现有外部事件语义，完成后清理 transient；不按文本内容全局去重。验证：同一命令依次输入 `你好`、`，世界` 与完成文本，最终只显示一份；两条内容相同但身份不同的历史回复都保留。
- [x] 3.2 将等待状态纳入面板。已确认入口：面板/ChatPage 可见状态。RED：`yarn workspace voiceclaw-desktop test src/renderer/src/pages/ChatPage.output-panel.test.tsx -t "shows waiting inline"`；预期失败：等待状态仍是独立气泡。最小 GREEN：现有 waiting 条件对应面板内可访问状态提示，正文到达后退出提示，不创建空回复。验证：同一命令通过。
- [x] 3.3 保留打断与结束后的清理。已确认入口：ChatPage 可见流式输出。RED：`yarn workspace voiceclaw-desktop test src/renderer/src/pages/ChatPage.output-panel.test.tsx -t "clears transient panel state"`；预期失败：新增面板状态在打断或结束后残留。最小 GREEN：复用现有清理路径，去除 transient 指示且不删除完成回复。验证：同一命令覆盖打断、正常结束和最终断开；已通过的路径记为既有 GREEN。
- [x] 3.4 保留每条回复的复制操作。已确认入口：ChatPage 消息菜单交互。RED：`yarn workspace voiceclaw-desktop test src/renderer/src/pages/ChatPage.output-panel.test.tsx -t "copies only the selected panel reply"`；预期失败：面板没有将消息菜单绑定到目标 Message。最小 GREEN：复用原菜单及复制动作，正文保持可选。验证：同一命令确认剪贴板边界收到目标回复原文，不包含邻近消息。
- [x] 3.5 保留附件及元信息。已确认入口：面板组件可见内容与附件动作。RED：`yarn workspace voiceclaw-desktop test src/renderer/src/components/AssistantOutputPanel.test.tsx -t "preserves reply attachments and metadata"`；预期失败：面板缺少已有图片、附件或启用的时间/延迟信息。最小 GREEN：复用已有内容渲染和开关，附件继续打开原目标。验证：同一命令通过；若附件与元信息需要独立生产改动，实施前拆分为两个单独 RED/GREEN 任务并重新校验。
- [x] 3.6 保留暂停滚动和返回最新行为。已确认入口：ChatPage 滚动交互。RED：`yarn workspace voiceclaw-desktop test src/renderer/src/pages/ChatPage.output-panel.test.tsx -t "preserves reading position while output grows"`；预期失败：面板更新在上滑时强制滚动或无法恢复跟随。最小 GREEN：继续复用唯一滚动容器、锚点和现有跟随状态，仅修复面板集成引起的差异。验证：同一命令涵盖底部跟随、上滑后新文字、点击跳到最新；已有通过行为记录为 GREEN，真实像素位置留给 4.2。

## 4. 综合验收与评审

- [x] 4.1 在上述独立循环完成后运行 `yarn workspace voiceclaw-desktop test`、`yarn workspace voiceclaw-desktop typecheck` 和 `yarn workspace voiceclaw-desktop build`；记录既有失败与新增失败，解决本变更引入的问题。验证：受影响测试通过，类型检查和构建结果有明确记录。
- [x] 4.2 手动在 Electron 验收长中文、段落、长无空格文本、图片、窄窗口、明暗主题、多轮及工具穿插；确认无横向溢出、无 AI 气泡和 80% 限宽，流式完成不重复或强制跳动，上滑阅读与跳到最新正常。检查用户气泡及其他模式、历史加载、设置返回与通话期间模式锁定，并实际验证 STT 输入、typed-input、TTS 播放、静音和音量。验证：按 spec 场景记录结果和界面证据，不将 DOM fixture 当作真实音频验收。
- [x] 4.3 调用 `$code-review`，使用 design.md 固定比较点、已有 diff 记录和本变更文档完成 Standards/Spec 评审；处理发现并重跑受影响验证，再运行 `openspec validate replace-stt-tts-assistant-bubbles-with-output-panel --strict`。验证：无阻塞发现，严格校验通过。
- [x] 4.4 仅在所有任务的验证已完成后调用 `$openspec-archive-change` 归档。验证：增量规范正确同步且归档状态成功。

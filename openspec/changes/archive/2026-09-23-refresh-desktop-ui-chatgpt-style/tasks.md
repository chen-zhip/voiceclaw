## 1. 实施准备

用户已于 2026-09-22 确认公开测试入口：侧栏导航及选中状态、窄窗口导航、居中对话区与底部输入面板、通话控制可达性、明暗主题与键盘焦点，以及现有 STT/TTS 文本面板和 History/Settings 行为回归。实施时每个行为任务开始前单独调用 `$tdd`，严格按任务所列命令完成 RED、最小 GREEN 和同命令复验；若行为已经通过，则记录为既有 GREEN，不伪造 RED，并在开始生产改动前拆出真正缺失的行为。

- [x] 1.1 保存受影响 renderer 文件的当前 diff 与未跟踪文件清单，并将其与 `design.md` 中固定比较点 `2264f0af6186abd25cf8185d635cf049f6ad3239` 一起记录为最终评审输入；核对 proposal、spec、design 与当前页面结构一致。验证：`openspec validate refresh-desktop-ui-chatgpt-style --strict` 通过，基线记录能区分本变更与工作区已有改动。
- [x] 1.2 扩展现有 jsdom renderer fixture，使测试可以通过公开浏览器边界控制常规/窄窗口、系统主题和 reduced-motion，并能挂载真实 shell、Chat、History 与 Settings 组件。此项仅建立测试设施，不宣称产品行为 RED。验证：`yarn workspace voiceclaw-desktop test src/renderer/src/test/renderer-test-environment.test.tsx` 通过，新增界面测试可被 Vitest 发现。

## 2. 桌面外壳与导航

- [x] 2.1 实现常规宽度的 VoiceClaw 导航 rail。已确认公开入口：侧栏导航及选中状态。RED：`yarn workspace voiceclaw-desktop test src/renderer/src/components/DesktopShell.test.tsx -t "navigates primary destinations"`；预期失败：当前只有横向 TabBar，无法提供命名的主导航、纵向 Chat/History/Settings 入口和可识别的当前项。最小 GREEN：建立 shell/rail，将现有 `activeTab` 与点击回调接入，使用 VoiceClaw 品牌和语义化选中状态，不增加参考图中的无关产品入口；同一轮应用基础中性 surface、间距和焦点 tokens。验证：同一命令通过，鼠标与键盘激活均更新当前 destination。
- [x] 2.2 将 shell 接入 App 并保留已挂载的 Chat 状态与现有快捷键。已确认公开入口：侧栏导航、键盘焦点和返回 Chat 后的可见状态。RED：`yarn workspace voiceclaw-desktop test src/renderer/src/App.interface-shell.test.tsx -t "preserves Chat while navigating"`；预期失败：App 仍由顶部 TabBar 组成，且没有通过新 shell 证明隐藏 destination 不可交互、Chat 在 History/Settings 往返后仍为同一挂载实例。最小 GREEN：让 App 继续持有 destination 状态和三页 mounted 容器，把新 shell 作为布局层，并保持 Ctrl/Cmd+1/2/3 与 Ctrl/Cmd+, 行为。验证：同一命令覆盖点击与快捷键、`aria-current`、隐藏页不可交互及返回 Chat 后状态保留。
- [x] 2.3 实现窄窗口的临时或紧凑导航。已确认公开入口：窄窗口导航。RED：`yarn workspace voiceclaw-desktop test src/renderer/src/components/DesktopShell.test.tsx -t "keeps destinations reachable at narrow width"`；预期失败：常驻完整 rail 占用窄窗口且不存在可命名的菜单开关或紧凑入口。最小 GREEN：依据公开 viewport 边界切换布局，提供带 accessible name 的开关、焦点管理、Escape/选择后关闭和恢复常规宽度的行为，同时保留当前 destination。验证：同一命令覆盖收窄、打开、选择、关闭、恢复宽度和选中状态。

## 3. 对话工作区与语音控制

- [x] 3.1 建立居中阅读列、安静页头和底部 composer dock。已确认公开入口：居中对话区与底部输入面板。RED：`yarn workspace voiceclaw-desktop test src/renderer/src/pages/ChatPage.interface-shell.test.tsx -t "keeps transcript and composer in one workspace"`；预期失败：现有 ChatPage 没有可识别的 transcript/workspace/composer landmarks，输入区和独立 footer 也未表达新的组合关系。最小 GREEN：保留唯一 transcript 滚动容器，在其内增加居中内容列；将 ChatComposer、附件托盘和必要状态放入底部 dock，并为可增长 dock 预留 transcript 底部空间。验证：同一命令确认消息顺序、composer 可达、附件入口和 jump-to-latest 仍属于同一工作区；真实宽度与遮挡留给 5.1。
- [x] 3.2 把 connecting/active 通话控制纳入 composer dock。已确认公开入口：通话控制可达性。RED：`yarn workspace voiceclaw-desktop test src/renderer/src/pages/ChatPage.interface-shell.test.tsx -t "keeps active voice controls reachable in the dock"`；预期失败：当前通话控制位于独立全宽 footer，且没有统一 dock 状态或 VoiceClaw signal 状态表达。最小 GREEN：闲置时保留紧凑的通话入口，connecting/active 时在 dock 内展开现有麦克风、输出音频、音量、屏幕共享和结束动作；状态线仅映射既有会话状态，并在 reduced-motion 下不执行非必要脉动。验证：同一命令覆盖 idle、connecting、active、muted、output-muted 与 end-call 可见状态，不改调用协议。
- [x] 3.3 适配错误、等待、附件和长输入到新 dock/reading column。已确认公开入口：底部输入面板和现有 STT/TTS 文本面板回归。RED：`yarn workspace voiceclaw-desktop test src/renderer/src/pages/ChatPage.interface-shell.test.tsx -t "keeps conversation affordances visible as the dock grows"`；预期失败：现有结构没有验证多行输入、附件托盘、错误 banner、等待态与 transcript 底部间距在组合布局中的连续性。最小 GREEN：只调整这些现有内容的布局归属和间距，保留文案、事件与消息身份；不得用文本重复或第二滚动区绕过遮挡。验证：同一命令覆盖多行输入、附件、错误、等待和最新回复可见性，并重跑 `ChatPage.output-panel.test.tsx`。

## 4. 主题与辅助页面

- [x] 4.1 将视觉 tokens 收敛为深浅两套中性 shell 主题。已确认公开入口：明暗主题与键盘焦点。RED：`yarn workspace voiceclaw-desktop test src/renderer/src/components/DesktopShell.test.tsx -t "preserves navigation states across themes"`；预期失败：现有 warm paper/grid tokens 没有新 shell 的 workspace/navigation/raised/selected/signal 语义，也未通过真实控件验证主题切换后的 selected、focus、disabled 与 error 状态。最小 GREEN：建立 design 中的语义 token 映射，移除主 shell 的网格和 radial wash，保留 onboarding 自有风格；所有 icon-only 控件获得 accessible name，交互状态不只依赖颜色。验证：同一命令在 dark/light/system 状态下通过；实际颜色对比和 overlays 留给 5.1。
- [x] 4.2 将 History 迁移到共享页头、内容列和列表状态。已确认公开入口：History 行为回归。RED：`yarn workspace voiceclaw-desktop test src/renderer/src/pages/HistoryPage.interface-shell.test.tsx -t "keeps history actions in the refreshed surface"`；预期失败：现有 History 页面没有新 shell 的命名页头/内容区域和安静列表层级。最小 GREEN：仅重组和重绘现有 history 列表、空态、选择、删除与返回 Chat 动作，不改变数据库调用或 conversation 选择语义。验证：同一命令覆盖加载、空态、选择/恢复和删除入口。
- [x] 4.3 将 Settings 迁移到共享页头、分组区和控件层级。已确认公开入口：Settings 行为回归。RED：`yarn workspace voiceclaw-desktop test src/renderer/src/pages/SettingsPage.interface-shell.test.tsx -t "keeps settings controls in grouped sections"`；预期失败：现有 Settings 页面没有新 shell 的命名内容区与一致分组层级，主题/Provider/语音设备控件未在该结构下验证。最小 GREEN：以共享 section/divider 结构呈现现有设置，保留控件名称、读写边界、校验和保存时机。验证：同一命令覆盖主题选择、至少一个 Provider 字段和一个设备/语音控件的原有交互。

## 5. 真实窗口验收与收尾

- [x] 5.1 在真实 Electron 窗口对照用户提供的参考图验收，不复制其商标或专有入口。检查常规宽度与窄窗口、深色/浅色/系统主题、空白和长对话、多段与长无空格输出、附件、多行 composer、History、Settings、onboarding、update banner、菜单/overlay，以及 connecting/active 通话控制；确认无横向溢出、dock 不遮挡最新内容、焦点可见、reduced-motion 生效。验证：记录代表性窗口尺寸和每个 spec 场景的结果；DOM 测试不得代替像素、层级和对比度验收。
- [x] 5.2 运行 `yarn workspace voiceclaw-desktop test`、`yarn workspace voiceclaw-desktop typecheck`、`yarn workspace voiceclaw-desktop build` 与 `openspec validate refresh-desktop-ui-chatgpt-style --strict`；区分既有失败和本变更失败并解决新增回归。验证：renderer 测试、类型检查、生产构建和严格校验均有明确通过记录。
- [x] 5.3 调用 `$code-review`，以 design.md 固定比较点、1.1 基线、proposal、spec、design 和 tasks 完成 Standards/Spec 双评审；处理阻塞发现并重跑受影响验证。验证：无阻塞 finding，最终 `git diff --check` 与严格 OpenSpec 校验通过。
- [x] 5.4 仅在全部任务及验证完成后调用 `$openspec-archive-change`，同步 `desktop/interface-shell` 增量规范并归档。验证：主规范同步结果逐项匹配，归档状态成功。

## Why

桌面端 STT/TTS Harness 的 AI 输出目前使用聊天气泡，长回复受到宽度限制，实时输出与历史回复也采用两套展示结构。将其改为宽幅文本输出面板，方便持续阅读 AI 输出。

## What Changes

- STT/TTS Harness 视图中的 AI 回复以左对齐、无独立气泡背景和边框的宽幅正文呈现，按原有时间顺序保留轮次。
- 实时输出、已完成回复和等待状态采用一致的面板表达，完成时不重复显示回复。
- 保留文本选择、消息复制、附件、时间与延迟信息、工具记录、滚动定位及跳到最新的行为。
- 展示模式跟随当前有效语音模式：通话期间锁定启动模式，空闲时使用所选模式；历史消息按当前视图展示，不推断历史来源模式。
- 用户消息及其他语音模式保持现有展示，STT/TTS 音频链路和存储协议不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `voice/stt-tts-mode`: 增加 Desktop AI 文本面板的展示、流式交接、阅读交互与模式隔离要求。

## Impact

- Desktop renderer：`ChatPage.tsx`、新增 AI 输出组件及相关展示测试；可能提取 `MessageBubble.tsx` 中共用的正文和元信息渲染。
- 测试环境：现有 Vitest 为 Node 环境；实现时增加局部 DOM 测试环境以验证真实组件交互。
- 无 Relay、Harness Provider、语音协议、数据库结构或 Mobile 改动；不增加 Markdown 解析器或新的运行时业务依赖。
- 本轮仅创建和校验规划文档，所有实现与验证任务留待后续明确执行。

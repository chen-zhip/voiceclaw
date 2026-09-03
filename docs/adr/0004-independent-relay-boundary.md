# ADR-0004: Relay 保持独立部署边界

**Status:** Accepted

## Context

Desktop 可以为了个人使用而捆绑和监督本地 Relay，但 VoiceClaw 也需要支持独立 Relay 和跨设备 Client。

## Decision

Relay 是独立部署的 Core 服务并保留会话、语音和归档权威。Desktop 监督 bundled Relay 只是一种部署便利，Desktop Client 不得绕过 Relay 与 Harness 建立产品会话。

## Consequences

Desktop 只能停止自己启动的本地 Relay 子进程；外部 Relay 生命周期不受 Desktop 退出影响，跨边界合同不得依赖同进程或同机器部署。

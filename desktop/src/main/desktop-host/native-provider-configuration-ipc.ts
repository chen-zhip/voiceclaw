import type { DesktopHostRuntime } from './host-transport.js'
import type { NativeProviderConfiguration } from './native-provider-configuration.js'

export interface NativeProviderConfigurationIpcRegistrar {
  handle(channel: string, handler: (event: unknown, ...arguments_: any[]) => unknown): unknown
}

export function registerNativeProviderConfigurationIpc(
  ipc: NativeProviderConfigurationIpcRegistrar,
  runtime: DesktopHostRuntime
): void {
  ipc.handle(
    'desktop-host:save-provider-configuration',
    async (_event, configuration: NativeProviderConfiguration) => {
      await runtime.saveNativeProviderConfiguration(configuration)
      return { ok: true as const }
    }
  )
  ipc.handle(
    'desktop-host:provider-readiness',
    (
      _event,
      bindingId: string,
      readiness: { configured: boolean; executableDetected: boolean; [key: string]: unknown }
    ) => runtime.projectNativeProviderReadiness(bindingId, readiness)
  )
}

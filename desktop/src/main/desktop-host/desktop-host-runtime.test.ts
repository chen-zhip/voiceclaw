import { describe, expect, it, vi } from 'vitest'
import { DesktopHostCredentialStore, DesktopHostRuntime } from './host-transport.js'
import { ProviderProcessSupervisor } from './provider-process.js'

describe('DesktopHostRuntime lifecycle', () => {
  it('starts and stops only Desktop-owned Host resources', async () => {
    const lifecycle: string[] = []
    const terminate = vi.fn(async (pid: number) => lifecycle.push(`terminate:${pid}`))
    const processes = new ProviderProcessSupervisor({
      detectExecutable: async () => true,
      start: async () => ({ pid: 101 }),
      terminate,
    })
    await processes.start('started-provider', { executablePath: 'codex', args: [] })
    await processes.adopt('adopted-provider', { pid: 202, executablePath: 'codex' })
    await processes.connect('external-provider', { pid: 303, executablePath: 'codex' })
    const runtime = new DesktopHostRuntime({
      credentialStore: new DesktopHostCredentialStore(
        { isEncryptionAvailable: () => true, encryptString: Buffer.from, decryptString: String },
        { write: async () => undefined, read: async () => null, clear: async () => undefined }
      ),
      processes,
      lifecycle: {
        prepareConfiguration: async () => lifecycle.push('configuration'),
        loadContributions: async () => lifecycle.push('contributions'),
        connectHost: async () => lifecycle.push('connect'),
        closeHost: async () => lifecycle.push('close'),
        expireBootstrap: () => lifecycle.push('expire'),
      },
    })

    expect(runtime.status()).toEqual({ state: 'idle' })
    await runtime.start()
    expect(lifecycle).toEqual(['configuration', 'contributions', 'connect'])
    expect(runtime.status()).toEqual({ state: 'running' })

    await runtime.stop()
    expect(lifecycle).toEqual([
      'configuration',
      'contributions',
      'connect',
      'close',
      'expire',
      'terminate:101',
      'terminate:202',
    ])
    expect(terminate).not.toHaveBeenCalledWith(303)
    expect(runtime.status()).toEqual({ state: 'stopped' })
    await runtime.stop()
    expect(terminate).toHaveBeenCalledTimes(2)
  })
})

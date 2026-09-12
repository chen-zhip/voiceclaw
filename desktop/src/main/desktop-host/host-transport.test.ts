import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  DesktopHostCredentialStore,
  DesktopHostRuntime,
  type HostTransportSocket,
} from './host-transport'

describe('Desktop Host transport', () => {
  it('maintains an established outbound Host connection', async () => {
    const sockets: LoopbackHostSocket[] = []
    const runtime = new DesktopHostRuntime({
      credentialStore: new DesktopHostCredentialStore(
        {
          isEncryptionAvailable: () => true,
          encryptString: Buffer.from,
          decryptString: () => 'credential',
        },
        {
          write: async () => undefined,
          read: async () => ({ hostId: 'host-1', encryptedCredential: Buffer.alloc(0) }),
          clear: async () => undefined,
        }
      ),
      reconnectDelayMs: 0,
      createSocket: () => {
        const socket = new LoopbackHostSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.emit('open'))
        return socket
      },
    })

    await runtime.connectRemote('wss://relay.example/host/ws')
    sockets[0].close()
    await vi.waitFor(() => expect(sockets).toHaveLength(2))
    await runtime.stop()
  })

  it('stores one Host Credential securely and initiates outbound WSS', async () => {
    const encryptedWrites: Buffer[] = []
    const encryptedReads: Buffer[] = []
    const plaintextEncryptionInputs: string[] = []
    const secureStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => {
        plaintextEncryptionInputs.push(value)
        return Buffer.from(`encrypted:${value.length}`)
      },
      decryptString: (value: Buffer) => {
        encryptedReads.push(value)
        return 'remote-host-credential'
      },
    }
    const persistence = {
      write: vi.fn(async (_hostId: string, encrypted: Buffer) => {
        encryptedWrites.push(encrypted)
      }),
      read: vi.fn(async () => ({
        hostId: 'host-1',
        encryptedCredential: encryptedWrites[0],
      })),
      clear: vi.fn(async () => undefined),
    }
    const connectionAttempts: Array<{
      url: string
      protocol: string
      headers: Record<string, string>
    }> = []
    const createSocket = vi.fn((url: string, protocol: string, headers: Record<string, string>) => {
      connectionAttempts.push({ url, protocol, headers })
      const socket = new LoopbackHostSocket()
      queueMicrotask(() => socket.emit('open'))
      return socket
    })
    const logs: string[] = []
    const credentialStore = new DesktopHostCredentialStore(secureStorage, persistence)
    const runtime = new DesktopHostRuntime({
      credentialStore,
      createSocket,
      log: (line) => logs.push(line),
    })

    await runtime.storeRemoteCredential({
      hostId: 'host-1',
      credential: 'remote-host-credential',
    })
    await runtime.connectRemote('wss://relay.example/host/ws')
    await runtime.reconnectRemote()

    expect(plaintextEncryptionInputs).toEqual(['remote-host-credential'])
    expect(encryptedWrites.map(String)).toEqual(['encrypted:22'])
    expect(encryptedReads).toHaveLength(2)
    expect(connectionAttempts).toEqual([
      {
        url: 'wss://relay.example/host/ws',
        protocol: 'voiceclaw.host.v1',
        headers: { authorization: 'Host remote-host-credential' },
      },
      {
        url: 'wss://relay.example/host/ws',
        protocol: 'voiceclaw.host.v1',
        headers: { authorization: 'Host remote-host-credential' },
      },
    ])
    expect(JSON.stringify(runtime.describe())).not.toContain('remote-host-credential')
    expect(JSON.stringify(logs)).not.toContain('remote-host-credential')
    expect(JSON.stringify(persistence.write.mock.calls)).not.toContain('remote-host-credential')
    await expect(runtime.connectRemote('ws://relay.example/host/ws')).rejects.toThrow(
      'secure_wss_required'
    )
  })
})

class LoopbackHostSocket extends EventEmitter implements HostTransportSocket {
  close(): void {
    this.emit('close')
  }
}

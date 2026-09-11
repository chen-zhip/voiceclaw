import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const isPackagedRef = { value: false }
const existsRef = { fn: (_p: string) => false as boolean }
const tokenRef = { value: null as string | null }
const providerKeysRef = { fn: (_p: 'gemini' | 'openai' | 'xai') => null as string | null }
const bundledRelayKeyRef = { value: null as string | null }
const tavilyKeyRef = { value: null as string | null }
const allocatedPortsRef: {
  openclawGateway: number | undefined
  relay: number | undefined
} = { openclawGateway: undefined, relay: undefined }
const bundledNodeRef = { value: null as string | null }
let originalResourcesPath: string | undefined
const TEST_RESOURCES_PATH = join(tmpdir(), 'VoiceClaw', 'Resources')
const RELAY_BUNDLED_SCRIPT_SUFFIX = join('relay-server-bundle', 'dist', 'index.js')
const RELAY_SOURCE_SUFFIX = join('relay-server', 'src', 'index.ts')
const TSX_CLI_SUFFIX = join('tsx', 'dist', 'cli.mjs')

vi.mock('electron', () => ({
  app: {
    get isPackaged(): boolean {
      return isPackagedRef.value
    },
  },
}))

vi.mock('../ports', () => ({
  allocatePort: vi.fn(),
  getAllocatedPorts: () => ({ ...allocatedPortsRef }),
  markAllocatedPort: vi.fn(),
}))

vi.mock('fs', () => ({
  existsSync: (path: string) => existsRef.fn(path),
}))

vi.mock('../provider-keys', () => ({
  getProviderKey: (provider: 'gemini' | 'openai' | 'xai') => providerKeysRef.fn(provider),
}))

vi.mock('../onboarding', () => ({
  getBundledRelayApiKey: () => bundledRelayKeyRef.value,
  getTavilyApiKey: () => tavilyKeyRef.value,
}))

vi.mock('./node-runtime', () => ({
  resolveBundledNode: () => bundledNodeRef.value,
}))

vi.mock('./openclaw-gateway', () => ({
  readGatewayAuthToken: (_path: string) => tokenRef.value,
  getOpenClawConfigPath: () => '/tmp/openclaw.json',
}))

describe('resolveBundledRelayScript', () => {
  beforeEach(() => {
    originalResourcesPath = process.resourcesPath
    isPackagedRef.value = false
    existsRef.fn = () => false
  })

  afterEach(() => {
    if (originalResourcesPath !== undefined) {
      Object.defineProperty(process, 'resourcesPath', {
        value: originalResourcesPath,
        configurable: true,
      })
    }
    vi.resetModules()
  })

  it('returns packaged path when app.isPackaged and script exists', async () => {
    isPackagedRef.value = true
    Object.defineProperty(process, 'resourcesPath', {
      value: TEST_RESOURCES_PATH,
      configurable: true,
    })
    const expected = join(TEST_RESOURCES_PATH, RELAY_BUNDLED_SCRIPT_SUFFIX)
    existsRef.fn = (p: string) => p === expected

    const { resolveBundledRelayScript } = await import('./relay-server')
    expect(resolveBundledRelayScript()).toBe(expected)
  })

  it('returns null in packaged mode when script is missing', async () => {
    isPackagedRef.value = true
    Object.defineProperty(process, 'resourcesPath', {
      value: TEST_RESOURCES_PATH,
      configurable: true,
    })
    existsRef.fn = () => false

    const { resolveBundledRelayScript } = await import('./relay-server')
    expect(resolveBundledRelayScript()).toBeNull()
  })

  it('returns dev path when not packaged and script exists in resources/', async () => {
    isPackagedRef.value = false
    existsRef.fn = (p: string) => p.endsWith(join('resources', RELAY_BUNDLED_SCRIPT_SUFFIX))

    const { resolveBundledRelayScript } = await import('./relay-server')
    const resolved = resolveBundledRelayScript()
    expect(resolved).not.toBeNull()
    expect(resolved!.endsWith(join('resources', RELAY_BUNDLED_SCRIPT_SUFFIX))).toBe(true)
  })

  it('returns null in dev when script is absent (the common dev case)', async () => {
    isPackagedRef.value = false
    existsRef.fn = () => false

    const { resolveBundledRelayScript } = await import('./relay-server')
    expect(resolveBundledRelayScript()).toBeNull()
  })
})

describe('buildRelayEnv', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k]
    Object.assign(process.env, originalEnv)
    delete process.env.GEMINI_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.XAI_API_KEY
    delete process.env.BRAIN_GATEWAY_AUTH_TOKEN
    delete process.env.RELAY_API_KEY
    delete process.env.TAVILY_API_KEY
    tokenRef.value = null
    providerKeysRef.fn = () => null
    bundledRelayKeyRef.value = null
    tavilyKeyRef.value = null
    allocatedPortsRef.openclawGateway = undefined
  })

  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k]
    Object.assign(process.env, originalEnv)
    vi.resetModules()
  })

  it('forwards provider keys from the keychain when env is empty', async () => {
    providerKeysRef.fn = (p) => (p === 'gemini' ? 'gemini-secret' : null)
    const { buildRelayEnv } = await import('./relay-server')
    const env = buildRelayEnv()
    expect(env.GEMINI_API_KEY).toBe('gemini-secret')
    expect(env.OPENAI_API_KEY).toBeUndefined()
  })

  it('uses keychain as the only source of provider keys (env is not forwarded)', async () => {
    process.env.GEMINI_API_KEY = 'env-ignored'
    providerKeysRef.fn = (p) => (p === 'gemini' ? 'keychain-wins' : null)
    const { buildRelayEnv } = await import('./relay-server')
    const env = buildRelayEnv()
    expect(env.GEMINI_API_KEY).toBe('keychain-wins')
  })

  it('injects BRAIN_GATEWAY_AUTH_TOKEN from the openclaw config when env is empty', async () => {
    tokenRef.value = 'baked-token'
    const { buildRelayEnv } = await import('./relay-server')
    const env = buildRelayEnv()
    expect(env.BRAIN_GATEWAY_AUTH_TOKEN).toBe('baked-token')
  })

  it('does not override an explicit BRAIN_GATEWAY_AUTH_TOKEN env value', async () => {
    process.env.BRAIN_GATEWAY_AUTH_TOKEN = 'env-token'
    tokenRef.value = 'baked-token'
    const { buildRelayEnv } = await import('./relay-server')
    const env = buildRelayEnv()
    expect(env.BRAIN_GATEWAY_AUTH_TOKEN).toBe('env-token')
  })

  it('injects RELAY_API_KEY from the bundled-defaults store when env is empty', async () => {
    bundledRelayKeyRef.value = 'shared-secret-uuid'
    const { buildRelayEnv } = await import('./relay-server')
    const env = buildRelayEnv()
    expect(env.RELAY_API_KEY).toBe('shared-secret-uuid')
  })

  it('does not override an explicit RELAY_API_KEY env value', async () => {
    process.env.RELAY_API_KEY = 'env-relay-key'
    bundledRelayKeyRef.value = 'bundled-uuid'
    const { buildRelayEnv } = await import('./relay-server')
    const env = buildRelayEnv()
    expect(env.RELAY_API_KEY).toBe('env-relay-key')
  })

  it('injects BRAIN_GATEWAY_URL from the allocated openclaw port when env is unset', async () => {
    allocatedPortsRef.openclawGateway = 19876
    delete process.env.BRAIN_GATEWAY_URL
    const { buildRelayEnv } = await import('./relay-server')
    const env = buildRelayEnv()
    expect(env.BRAIN_GATEWAY_URL).toBe('http://127.0.0.1:19876')
  })

  it('does not override an explicit BRAIN_GATEWAY_URL env value', async () => {
    process.env.BRAIN_GATEWAY_URL = 'http://localhost:9999'
    allocatedPortsRef.openclawGateway = 19876
    const { buildRelayEnv } = await import('./relay-server')
    const env = buildRelayEnv()
    expect(env.BRAIN_GATEWAY_URL).toBe('http://localhost:9999')
  })

  it('leaves BRAIN_GATEWAY_URL unset when no openclaw port is allocated', async () => {
    allocatedPortsRef.openclawGateway = undefined
    delete process.env.BRAIN_GATEWAY_URL
    const { buildRelayEnv } = await import('./relay-server')
    const env = buildRelayEnv()
    expect(env.BRAIN_GATEWAY_URL).toBeUndefined()
  })

  it('injects TAVILY_API_KEY from the SQLite settings store when env is empty', async () => {
    tavilyKeyRef.value = 'sqlite-tavily-key'
    const { buildRelayEnv } = await import('./relay-server')
    const env = buildRelayEnv()
    expect(env.TAVILY_API_KEY).toBe('sqlite-tavily-key')
  })

  it('does not override an explicit TAVILY_API_KEY env value', async () => {
    process.env.TAVILY_API_KEY = 'env-tavily-key'
    tavilyKeyRef.value = 'sqlite-tavily-key'
    const { buildRelayEnv } = await import('./relay-server')
    const env = buildRelayEnv()
    expect(env.TAVILY_API_KEY).toBe('env-tavily-key')
  })

  it('leaves TAVILY_API_KEY unset when neither env nor store has a value', async () => {
    tavilyKeyRef.value = null
    const { buildRelayEnv } = await import('./relay-server')
    const env = buildRelayEnv()
    expect(env.TAVILY_API_KEY).toBeUndefined()
  })

  it('sets RELAY_BIND_HOST=0.0.0.0 by default so the desktop-managed relay stays reachable on the tailnet', async () => {
    delete process.env.RELAY_BIND_HOST
    const { buildRelayEnv } = await import('./relay-server')
    const env = buildRelayEnv()
    expect(env.RELAY_BIND_HOST).toBe('0.0.0.0')
  })

  it('does not override an explicit RELAY_BIND_HOST env value', async () => {
    process.env.RELAY_BIND_HOST = '127.0.0.1'
    const { buildRelayEnv } = await import('./relay-server')
    const env = buildRelayEnv()
    expect(env.RELAY_BIND_HOST).toBe('127.0.0.1')
  })
})

describe('resolveRelaySpawn', () => {
  beforeEach(() => {
    originalResourcesPath = process.resourcesPath
    isPackagedRef.value = false
    existsRef.fn = () => false
    bundledNodeRef.value = null
  })

  afterEach(() => {
    if (originalResourcesPath !== undefined) {
      Object.defineProperty(process, 'resourcesPath', {
        value: originalResourcesPath,
        configurable: true,
      })
    }
    vi.resetModules()
  })

  it('packaged: returns bundled-node + bundled-script when both exist', async () => {
    isPackagedRef.value = true
    Object.defineProperty(process, 'resourcesPath', {
      value: TEST_RESOURCES_PATH,
      configurable: true,
    })
    const bundledNode = join(TEST_RESOURCES_PATH, 'bin', 'node')
    const bundledScript = join(TEST_RESOURCES_PATH, RELAY_BUNDLED_SCRIPT_SUFFIX)
    bundledNodeRef.value = bundledNode
    existsRef.fn = (p: string) => p === bundledScript

    const { resolveRelaySpawn } = await import('./relay-server')
    const spec = resolveRelaySpawn()
    expect(spec).not.toBeNull()
    expect(spec!.command).toBe(bundledNode)
    expect(spec!.args).toEqual([bundledScript])
  })

  it('packaged: returns null when bundled script is missing', async () => {
    isPackagedRef.value = true
    Object.defineProperty(process, 'resourcesPath', {
      value: TEST_RESOURCES_PATH,
      configurable: true,
    })
    existsRef.fn = () => false

    const { resolveRelaySpawn } = await import('./relay-server')
    expect(resolveRelaySpawn()).toBeNull()
  })

  it('dev: spawns relay-server source via tsx when bundled script is absent', async () => {
    isPackagedRef.value = false
    bundledNodeRef.value = null
    existsRef.fn = (p: string) => p.endsWith(RELAY_SOURCE_SUFFIX) || p.endsWith(TSX_CLI_SUFFIX)

    const { resolveRelaySpawn } = await import('./relay-server')
    const spec = resolveRelaySpawn()
    expect(spec).not.toBeNull()
    expect(spec!.command).toBe(process.execPath)
    expect(spec!.args[0].endsWith(TSX_CLI_SUFFIX)).toBe(true)
    expect(spec!.args[1].endsWith(RELAY_SOURCE_SUFFIX)).toBe(true)
  })

  it('dev: prefers staged bundle over source when the bundle is present', async () => {
    isPackagedRef.value = false
    bundledNodeRef.value = '/dev/bin/node'
    existsRef.fn = (p: string) => p.endsWith(join('resources', RELAY_BUNDLED_SCRIPT_SUFFIX))

    const { resolveRelaySpawn } = await import('./relay-server')
    const spec = resolveRelaySpawn()
    expect(spec).not.toBeNull()
    expect(spec!.command).toBe('/dev/bin/node')
    expect(spec!.args[0].endsWith(join('resources', RELAY_BUNDLED_SCRIPT_SUFFIX))).toBe(true)
  })

  it('dev: returns null when neither bundle, source, nor tsx is available', async () => {
    isPackagedRef.value = false
    bundledNodeRef.value = null
    existsRef.fn = () => false

    const { resolveRelaySpawn } = await import('./relay-server')
    expect(resolveRelaySpawn()).toBeNull()
  })

  it('dev: returns null when source exists but tsx cannot be located', async () => {
    isPackagedRef.value = false
    bundledNodeRef.value = null
    existsRef.fn = (p: string) => p.endsWith(RELAY_SOURCE_SUFFIX)

    const { resolveRelaySpawn } = await import('./relay-server')
    expect(resolveRelaySpawn()).toBeNull()
  })
})

describe('getTailnetUrl', () => {
  beforeEach(() => {
    allocatedPortsRef.openclawGateway = undefined
    allocatedPortsRef.relay = undefined
  })

  it('returns wss://<hostname>:<port>/ws when a TLS handle is active', async () => {
    allocatedPortsRef.relay = 8080
    const { getTailnetUrl } = await import('./relay-server')
    const url = getTailnetUrl(
      () => ({
        en0: [{ family: 'IPv4', address: '192.168.1.42', internal: false } as never],
      }),
      () => ({
        hostname: 'macbook.tail0abcd.ts.net',
        certPath: '/tmp/cert.pem',
        keyPath: '/tmp/key.pem',
      })
    )
    expect(url).toBe('wss://macbook.tail0abcd.ts.net:8080/ws')
  })

  it('falls back to ws://<ip>:<port>/ws when no TLS handle is set', async () => {
    allocatedPortsRef.relay = 8080
    const { getTailnetUrl } = await import('./relay-server')
    const url = getTailnetUrl(
      () => ({
        en0: [{ family: 'IPv4', address: '100.64.0.5', internal: false } as never],
      }),
      () => null
    )
    expect(url).toBe('ws://100.64.0.5:8080/ws')
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('prefers the Tailscale CGNAT address over the LAN IP', async () => {
    allocatedPortsRef.relay = 8080
    const { getTailnetUrl } = await import('./relay-server')
    const url = getTailnetUrl(() => ({
      en0: [{ family: 'IPv4', address: '192.168.1.42', internal: false } as never],
      tailscale0: [{ family: 'IPv4', address: '100.115.7.9', internal: false } as never],
    }))
    expect(url).toBe('ws://100.115.7.9:8080/ws')
  })

  it('falls back to the first non-internal LAN IPv4 when no tailnet address is present', async () => {
    allocatedPortsRef.relay = 8080
    const { getTailnetUrl } = await import('./relay-server')
    const url = getTailnetUrl(() => ({
      lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true } as never],
      en0: [{ family: 'IPv4', address: '192.168.1.42', internal: false } as never],
    }))
    expect(url).toBe('ws://192.168.1.42:8080/ws')
  })

  it('uses the allocated relay port when one is recorded', async () => {
    allocatedPortsRef.relay = 53122
    const { getTailnetUrl } = await import('./relay-server')
    const url = getTailnetUrl(() => ({
      en0: [{ family: 'IPv4', address: '100.64.0.5', internal: false } as never],
    }))
    expect(url).toBe('ws://100.64.0.5:53122/ws')
  })

  it('falls back to port 8080 when nothing has been allocated yet', async () => {
    allocatedPortsRef.relay = undefined
    const { getTailnetUrl } = await import('./relay-server')
    const url = getTailnetUrl(() => ({
      en0: [{ family: 'IPv4', address: '100.64.0.5', internal: false } as never],
    }))
    expect(url).toBe('ws://100.64.0.5:8080/ws')
  })

  it('rejects 100.x addresses outside the CGNAT 100.64/10 block', async () => {
    allocatedPortsRef.relay = 8080
    const { getTailnetUrl } = await import('./relay-server')
    // 100.128.x.x is public IP space, not CGNAT — must NOT be picked as a tailnet host.
    const url = getTailnetUrl(() => ({
      eth0: [
        { family: 'IPv4', address: '100.128.5.5', internal: false } as never,
        { family: 'IPv4', address: '192.168.50.50', internal: false } as never,
      ],
    }))
    expect(url).toBe('ws://100.128.5.5:8080/ws') // first non-internal wins as LAN fallback
  })

  it('returns null when no non-internal IPv4 is available', async () => {
    allocatedPortsRef.relay = 8080
    const { getTailnetUrl } = await import('./relay-server')
    const url = getTailnetUrl(() => ({
      lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true } as never],
    }))
    expect(url).toBeNull()
  })
})

describe('startBundledRelayServer (external relay detection)', () => {
  beforeEach(() => {
    isPackagedRef.value = false
    existsRef.fn = () => false
    bundledNodeRef.value = null
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('skips spawning and records the preferred port when /health responds on :8080', async () => {
    isPackagedRef.value = false
    existsRef.fn = (p: string) => p.endsWith(RELAY_SOURCE_SUFFIX) || p.endsWith(TSX_CLI_SUFFIX)

    const { createServer } = await import('node:http')
    const server = createServer((req, res) => {
      if (req.url === '/health') {
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ status: 'ok' }))
        return
      }
      res.statusCode = 404
      res.end()
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(8080, '127.0.0.1', () => resolve())
    })

    try {
      const ports = await import('../ports')
      const sm = await import('./service-manager')
      const startSpy = vi.spyOn(sm.serviceManager, 'start').mockResolvedValue()
      const { startBundledRelayServer } = await import('./relay-server')
      await startBundledRelayServer()
      expect(startSpy).not.toHaveBeenCalled()
      expect(ports.markAllocatedPort as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        'relay',
        8080
      )
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const isPackagedRef = { value: false }
const existsRef = { fn: (_p: string) => false as boolean }
const readFileRef = { fn: (_p: string, _enc: string) => '{}' }
const writes: { path: string; content: string }[] = []
let originalResourcesPath: string | undefined
const TEST_RESOURCES_PATH = join(tmpdir(), 'VoiceClaw', 'Resources')

vi.mock('electron', () => ({
  app: {
    get isPackaged(): boolean {
      return isPackagedRef.value
    },
    getPath: () => '/tmp/voiceclaw-test',
  },
}))

vi.mock('fs', () => ({
  existsSync: (path: string) => existsRef.fn(path),
  copyFileSync: () => undefined,
  mkdirSync: () => undefined,
  readFileSync: (path: string, enc: string) => readFileRef.fn(path, enc),
  writeFileSync: (path: string, content: string) => {
    writes.push({ path, content })
  },
}))

vi.mock('../provider-keys', () => ({
  getProviderKey: () => null,
}))

describe('resolveBundledOpenClawScript', () => {
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
    const expected = join(TEST_RESOURCES_PATH, 'openclaw', 'openclaw.mjs')
    existsRef.fn = (p: string) => p === expected

    const { resolveBundledOpenClawScript } = await import('./openclaw-gateway')
    expect(resolveBundledOpenClawScript()).toBe(expected)
  })

  it('returns null in packaged mode when script is missing', async () => {
    isPackagedRef.value = true
    Object.defineProperty(process, 'resourcesPath', {
      value: TEST_RESOURCES_PATH,
      configurable: true,
    })
    existsRef.fn = () => false

    const { resolveBundledOpenClawScript } = await import('./openclaw-gateway')
    expect(resolveBundledOpenClawScript()).toBeNull()
  })

  it('returns dev path under vendor/openclaw/ when not packaged', async () => {
    isPackagedRef.value = false
    const suffix = join('vendor', 'openclaw', 'openclaw.mjs')
    existsRef.fn = (p: string) => p.endsWith(suffix)

    const { resolveBundledOpenClawScript } = await import('./openclaw-gateway')
    const resolved = resolveBundledOpenClawScript()
    expect(resolved).not.toBeNull()
    expect(resolved!.endsWith(suffix)).toBe(true)
  })
})

describe('readGatewayAuthToken', () => {
  beforeEach(() => {
    existsRef.fn = () => false
    readFileRef.fn = () => '{}'
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('returns null when the file is unreadable', async () => {
    existsRef.fn = () => false
    readFileRef.fn = () => {
      throw new Error('ENOENT')
    }
    const { readGatewayAuthToken } = await import('./openclaw-gateway')
    expect(readGatewayAuthToken('/missing.json')).toBeNull()
  })

  it('returns the token when the config has a string token', async () => {
    existsRef.fn = () => true
    readFileRef.fn = () => JSON.stringify({ gateway: { auth: { token: 'secret-xyz' } } })
    const { readGatewayAuthToken } = await import('./openclaw-gateway')
    expect(readGatewayAuthToken('/x.json')).toBe('secret-xyz')
  })

  it('returns null when the token is missing or wrong type', async () => {
    existsRef.fn = () => true
    readFileRef.fn = () => JSON.stringify({ gateway: { auth: { mode: 'token' } } })
    const { readGatewayAuthToken } = await import('./openclaw-gateway')
    expect(readGatewayAuthToken('/x.json')).toBeNull()

    readFileRef.fn = () => JSON.stringify({ gateway: { auth: { token: 123 } } })
    expect(readGatewayAuthToken('/x.json')).toBeNull()
  })
})

describe('applyGeminiKeyToOpenClawConfig', () => {
  beforeEach(() => {
    writes.length = 0
    existsRef.fn = () => false
    readFileRef.fn = () => '{}'
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('writes primary model and plugin enable when no config exists', async () => {
    existsRef.fn = () => false
    const { applyGeminiKeyToOpenClawConfig, BUNDLED_GOOGLE_PRIMARY_MODEL } =
      await import('./openclaw-gateway')
    const changed = applyGeminiKeyToOpenClawConfig('AIzaTESTKEY')
    expect(changed).toBe(true)
    expect(writes.length).toBe(1)
    const written = JSON.parse(writes[0].content)
    expect(written.models?.providers?.google).toBeUndefined()
    expect(written.agents.defaults.model.primary).toBe(BUNDLED_GOOGLE_PRIMARY_MODEL)
    expect(written.plugins.entries.google.enabled).toBe(true)
  })

  it('preserves existing fallbacks when overwriting the primary model', async () => {
    existsRef.fn = () => true
    readFileRef.fn = () =>
      JSON.stringify({
        agents: {
          defaults: {
            model: {
              primary: 'openai-codex/gpt-5.4',
              fallbacks: ['claude-cli/claude-haiku-4-5'],
            },
          },
        },
      })
    const { applyGeminiKeyToOpenClawConfig, BUNDLED_GOOGLE_PRIMARY_MODEL } =
      await import('./openclaw-gateway')
    applyGeminiKeyToOpenClawConfig('newkey')
    const written = JSON.parse(writes[0].content)
    expect(written.agents.defaults.model.primary).toBe(BUNDLED_GOOGLE_PRIMARY_MODEL)
    expect(written.agents.defaults.model.fallbacks).toEqual(['claude-cli/claude-haiku-4-5'])
  })

  it('returns false (no write) when agent model and plugin are already correct', async () => {
    existsRef.fn = () => true
    readFileRef.fn = () =>
      JSON.stringify({
        agents: {
          defaults: {
            model: { primary: 'google/gemini-3.1-pro-preview' },
          },
        },
        plugins: { entries: { google: { enabled: true } } },
      })
    const { applyGeminiKeyToOpenClawConfig } = await import('./openclaw-gateway')
    const changed = applyGeminiKeyToOpenClawConfig('anykey')
    expect(changed).toBe(false)
    expect(writes.length).toBe(0)
  })

  it('does not clobber unrelated channel/auth config blocks', async () => {
    existsRef.fn = () => true
    readFileRef.fn = () =>
      JSON.stringify({
        channels: { telegram: { enabled: true, botToken: 't' } },
        auth: { profiles: { 'openai-codex:me': { mode: 'oauth' } } },
        gateway: { auth: { mode: 'token', token: 'x' } },
      })
    const { applyGeminiKeyToOpenClawConfig } = await import('./openclaw-gateway')
    applyGeminiKeyToOpenClawConfig('k')
    const written = JSON.parse(writes[0].content)
    expect(written.channels.telegram.botToken).toBe('t')
    expect(written.auth.profiles['openai-codex:me'].mode).toBe('oauth')
    expect(written.gateway.auth.token).toBe('x')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const VOICECLAW_WORKSPACE = join(homedir(), '.voiceclaw', 'workspace')
const IDENTITY_PATH = join(VOICECLAW_WORKSPACE, 'IDENTITY.md')
const SOUL_PATH = join(VOICECLAW_WORKSPACE, 'SOUL.md')
const TEST_APP_PATH = join(tmpdir(), 'voiceclaw-app-path')
const TEST_USER_DATA_PATH = join(tmpdir(), 'voiceclaw-identity-test')

const writes: { path: string; content: string }[] = []
const fileSystem = new Map<string, string>()

vi.mock('fs', () => ({
  existsSync: (path: string) => fileSystem.has(path),
  mkdirSync: () => undefined,
  readFileSync: (path: string) => fileSystem.get(path) ?? '',
  writeFileSync: (path: string, content: string) => {
    writes.push({ path, content })
    fileSystem.set(path, content)
  },
}))

vi.mock('node:fs/promises', () => ({
  mkdir: async () => undefined,
  readFile: async (path: string, encoding?: string) => {
    if (!fileSystem.has(path)) {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    }
    const value = fileSystem.get(path) ?? ''
    if (encoding === 'utf8' || encoding === 'utf-8') return value
    return Buffer.from(value, 'utf8')
  },
  writeFile: async (path: string, content: string) => {
    writes.push({ path, content })
    fileSystem.set(path, content)
  },
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => TEST_USER_DATA_PATH,
    getAppPath: () => TEST_APP_PATH,
    isPackaged: false,
  },
  net: {
    fetch: () => {
      throw new Error('net.fetch not stubbed in this test')
    },
  },
}))

// voice-prefs imports './db' which transitively pulls in better-sqlite3.
// providerForVoice (the only function we use here) is pure, so stub the
// db module to keep this test isolated from the native binding.
vi.mock('./db', () => ({
  getDb: () => {
    throw new Error('getDb not stubbed in identity tests')
  },
}))

describe('writeAgentIdentity', () => {
  beforeEach(() => {
    writes.length = 0
    fileSystem.clear()
    delete process.env.VOICECLAW_WORKSPACE
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('writes IDENTITY.md to ~/.voiceclaw/workspace/', async () => {
    const { writeAgentIdentity } = await import('./identity')
    writeAgentIdentity({ name: 'Pam', description: 'Friendly.', voice: 'Aoede' })
    const identityWrite = writes.find((w) => w.path === IDENTITY_PATH)
    expect(identityWrite).toBeDefined()
  })

  it('renders all four required fields with the user-supplied values', async () => {
    const { writeAgentIdentity } = await import('./identity')
    const result = writeAgentIdentity({
      name: 'Pam',
      description: 'Friendly and calm.',
      voice: 'Aoede',
    })
    expect(result.name).toBe('Pam')
    expect(result.description).toBe('Friendly and calm.')
    expect(result.voice).toBe('Aoede')
    const identityWrite = writes.find((w) => w.path === IDENTITY_PATH)
    expect(identityWrite?.content).toContain('**Name:** Pam')
    expect(identityWrite?.content).toContain('**Vibe:** Friendly and calm.')
    expect(identityWrite?.content).toContain('**Voice:** Aoede')
    expect(identityWrite?.content).toContain('**Creature:** Personal voice companion')
  })

  it('falls back to defaults when fields are blank', async () => {
    const { writeAgentIdentity, DEFAULT_IDENTITY } = await import('./identity')
    const result = writeAgentIdentity({})
    expect(result.name).toBe(DEFAULT_IDENTITY.name)
    expect(result.description).toBe(DEFAULT_IDENTITY.description)
    expect(result.voice).toBe(DEFAULT_IDENTITY.voice)
    const identityWrite = writes.find((w) => w.path === IDENTITY_PATH)
    expect(identityWrite?.content).toContain(`**Name:** ${DEFAULT_IDENTITY.name}`)
  })

  it('trims whitespace and tolerates partial patches', async () => {
    const { writeAgentIdentity, DEFAULT_IDENTITY } = await import('./identity')
    const result = writeAgentIdentity({ name: '  Beatrix  ', voice: 'Kore' })
    expect(result.name).toBe('Beatrix')
    expect(result.voice).toBe('Kore')
    expect(result.description).toBe(DEFAULT_IDENTITY.description)
  })

  it('seeds a default SOUL.md alongside IDENTITY.md when no SOUL.md exists', async () => {
    const { writeAgentIdentity } = await import('./identity')
    writeAgentIdentity({ name: 'Pam' })
    const soulWrite = writes.find((w) => w.path === SOUL_PATH)
    expect(soulWrite).toBeDefined()
    expect(soulWrite?.content).toContain('## Core Truths')
    expect(soulWrite?.content).toContain('## Vibe')
    expect(soulWrite?.content).toContain('## Continuity')
  })

  it('does not overwrite an existing SOUL.md', async () => {
    fileSystem.set(SOUL_PATH, '# CUSTOM SOUL — keep me\n')
    const { writeAgentIdentity } = await import('./identity')
    writeAgentIdentity({ name: 'Pam' })
    const soulWrites = writes.filter((w) => w.path === SOUL_PATH)
    expect(soulWrites).toHaveLength(0)
    expect(fileSystem.get(SOUL_PATH)).toBe('# CUSTOM SOUL — keep me\n')
  })

  it('honors VOICECLAW_WORKSPACE override when set', async () => {
    const customWorkspace = join(tmpdir(), 'custom-vc-ws')
    process.env.VOICECLAW_WORKSPACE = customWorkspace
    const { writeAgentIdentity } = await import('./identity')
    writeAgentIdentity({ name: 'Pam' })
    expect(writes.find((w) => w.path === join(customWorkspace, 'IDENTITY.md'))).toBeDefined()
  })
})

describe('readAgentIdentity', () => {
  beforeEach(() => {
    writes.length = 0
    fileSystem.clear()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('returns defaults when no IDENTITY.md exists', async () => {
    const { readAgentIdentity, DEFAULT_IDENTITY } = await import('./identity')
    const id = readAgentIdentity()
    expect(id).toEqual(DEFAULT_IDENTITY)
  })

  it('parses Name / Vibe / Voice fields from a written file', async () => {
    const { writeAgentIdentity, readAgentIdentity } = await import('./identity')
    writeAgentIdentity({ name: 'Sage', description: 'Quiet and dry.', voice: 'Charon' })
    const id = readAgentIdentity()
    expect(id.name).toBe('Sage')
    expect(id.description).toBe('Quiet and dry.')
    expect(id.voice).toBe('Charon')
  })
})

describe('getBundledVoicePreview', () => {
  let fetchCalls: { url: string; init?: RequestInit }[] = []

  beforeEach(() => {
    writes.length = 0
    fileSystem.clear()
    fetchCalls = []
    vi.doMock('electron', () => ({
      app: {
        getPath: () => TEST_USER_DATA_PATH,
        getAppPath: () => TEST_APP_PATH,
        isPackaged: false,
      },
      net: {
        fetch: async (url: string, init?: RequestInit) => {
          fetchCalls.push({ url, init })
          throw new Error('net.fetch must NOT be called from getBundledVoicePreview')
        },
      },
    }))
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
  })

  it('reads bundled Gemini WAVs without ever hitting the network', async () => {
    const wavBytes = 'PRETEND-GEMINI-WAV-BYTES'
    fileSystem.set(
      join(TEST_APP_PATH, 'resources', 'voice-previews', 'gemini', 'Zephyr.wav'),
      wavBytes
    )
    const { getBundledVoicePreview } = await import('./identity')
    const result = await getBundledVoicePreview({ voice: 'Zephyr' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mimeType).toBe('audio/wav')
      expect(Buffer.from(result.audioBase64, 'base64').toString('utf8')).toBe(wavBytes)
    }
    expect(fetchCalls).toHaveLength(0)
  })

  it('reads bundled xAI WAVs without ever hitting the network', async () => {
    const wavBytes = 'PRETEND-XAI-WAV-BYTES'
    fileSystem.set(join(TEST_APP_PATH, 'resources', 'voice-previews', 'xai', 'eve.wav'), wavBytes)
    const { getBundledVoicePreview } = await import('./identity')
    const result = await getBundledVoicePreview({ voice: 'eve' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mimeType).toBe('audio/wav')
      expect(Buffer.from(result.audioBase64, 'base64').toString('utf8')).toBe(wavBytes)
    }
    expect(fetchCalls).toHaveLength(0)
  })

  it('does not write any files (no userData lazy cache)', async () => {
    fileSystem.set(join(TEST_APP_PATH, 'resources', 'voice-previews', 'gemini', 'Puck.wav'), 'a')
    fileSystem.set(join(TEST_APP_PATH, 'resources', 'voice-previews', 'xai', 'rex.wav'), 'b')
    const { getBundledVoicePreview } = await import('./identity')
    await getBundledVoicePreview({ voice: 'Puck' })
    await getBundledVoicePreview({ voice: 'rex' })
    expect(writes.filter((w) => w.path.includes('voice-previews'))).toHaveLength(0)
  })

  it('returns an error when a bundled preview is missing', async () => {
    const { getBundledVoicePreview } = await import('./identity')
    const result = await getBundledVoicePreview({ voice: 'Aoede' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Aoede/)
    expect(fetchCalls).toHaveLength(0)
  })

  it('returns an error for an unknown voice', async () => {
    const { getBundledVoicePreview } = await import('./identity')
    const result = await getBundledVoicePreview({ voice: 'NotAVoice' })
    expect(result.ok).toBe(false)
    expect(fetchCalls).toHaveLength(0)
  })
})

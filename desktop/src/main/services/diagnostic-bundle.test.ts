import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '' },
}))

vi.mock('../db', () => ({ getDb: vi.fn() }))
vi.mock('../logs', () => ({ getLogDir: vi.fn() }))
vi.mock('./service-manager', () => ({ serviceManager: {} }))
vi.mock('./openclaw-gateway', () => ({ getOpenClawConfigPath: vi.fn() }))
vi.mock('../telemetry', () => ({ getDistinctId: vi.fn() }))

import { redactOpenClawConfig } from './diagnostic-bundle'

describe('redactOpenClawConfig', () => {
  it('replaces apiKey values with <redacted>', () => {
    const config = {
      models: {
        mode: 'merge',
        providers: {
          google: { apiKey: 'AIzaSyABCDEF1234567890realkey', model: 'gemini-pro' },
          openai: { apiKey: 'sk-real-openai-key-here', model: 'gpt-4' },
        },
      },
    }

    const result = redactOpenClawConfig(config)

    const providers = (result.models as Record<string, unknown>).providers as Record<
      string,
      Record<string, unknown>
    >
    expect(providers.google.apiKey).toBe('<redacted>')
    expect(providers.openai.apiKey).toBe('<redacted>')
  })

  it('does not contain the original key string in the output JSON', () => {
    const realKey = 'AIzaSyABCDEF1234567890realkey'
    const config = {
      models: {
        providers: { google: { apiKey: realKey } },
      },
    }

    const result = redactOpenClawConfig(config)
    const json = JSON.stringify(result)

    expect(json).not.toContain(realKey)
    expect(json).toContain('<redacted>')
  })

  it('redacts gateway auth token', () => {
    const config = {
      gateway: { auth: { mode: 'token', token: 'super-secret-token-abc123' } },
    }

    const result = redactOpenClawConfig(config)
    const gateway = result.gateway as Record<string, Record<string, unknown>>
    expect(gateway.auth.token).toBe('<redacted>')
    expect(JSON.stringify(result)).not.toContain('super-secret-token-abc123')
  })

  it('does not mutate the original config', () => {
    const config = {
      models: { providers: { google: { apiKey: 'original-key' } } },
    }
    redactOpenClawConfig(config)
    const providers = config.models.providers as Record<string, Record<string, unknown>>
    expect(providers.google.apiKey).toBe('original-key')
  })

  it('handles missing providers gracefully', () => {
    const config = { models: { mode: 'merge' } }
    expect(() => redactOpenClawConfig(config)).not.toThrow()
  })

  it('handles empty config gracefully', () => {
    expect(() => redactOpenClawConfig({})).not.toThrow()
  })

  it('handles provider without apiKey', () => {
    const config = {
      models: {
        providers: {
          localModel: { endpoint: 'http://localhost:1234' },
        },
      },
    }
    const result = redactOpenClawConfig(config)
    const providers = (result.models as Record<string, unknown>).providers as Record<
      string,
      Record<string, unknown>
    >
    expect(providers.localModel.endpoint).toBe('http://localhost:1234')
    expect('apiKey' in providers.localModel).toBe(false)
  })
})

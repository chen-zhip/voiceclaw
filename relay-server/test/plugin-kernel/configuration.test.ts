import { describe, expect, it } from 'vitest'
import * as configuration from '../../src/plugin-kernel/configuration.js'

describe('Plugin configuration', () => {
  it('preserves the last valid configuration', () => {
    const PluginConfigurationStore = (configuration as Record<string, unknown>)
      .PluginConfigurationStore as
      | (new (
          schema: Record<string, unknown>,
          initial: Record<string, unknown>
        ) => {
          read(): Readonly<Record<string, unknown>>
          update(
            value: unknown
          ):
            | { success: true; value: Readonly<Record<string, unknown>> }
            | { success: false; errors: Array<{ path: string; code: string; message: string }> }
        })
      | undefined

    expect(typeof PluginConfigurationStore).toBe('function')
    if (!PluginConfigurationStore) return

    const store = new PluginConfigurationStore(
      {
        type: 'object',
        properties: {
          model: { type: 'string' },
          retries: { type: 'integer', minimum: 0 },
        },
        required: ['model'],
        additionalProperties: false,
      },
      { model: 'fixture', retries: 1 }
    )

    expect(store.update({ model: 'fixture', retries: -1, apiKey: 'top-secret' })).toEqual({
      success: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ path: 'retries', code: 'minimum' }),
        expect.objectContaining({ path: 'apiKey', code: 'additional_property' }),
      ]),
    })
    expect(JSON.stringify(store.update({ model: 'fixture', apiKey: 'top-secret' }))).not.toContain(
      'top-secret'
    )
    expect(store.read()).toEqual({ model: 'fixture', retries: 1 })

    expect(store.update({ model: 'updated', retries: 0 })).toEqual({
      success: true,
      value: { model: 'updated', retries: 0 },
    })
    expect(store.read()).toEqual({ model: 'updated', retries: 0 })
  })
})

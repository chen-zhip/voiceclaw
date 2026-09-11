import { describe, expect, it } from 'vitest'
import * as contracts from './index.js'

const validManifest = {
  manifestVersion: 0,
  id: 'voiceclaw-provider-fixture',
  version: '1.0.0',
  voiceclawVersionRange: '>=0.1.0 <0.2.0',
  feature: { id: 'fixture', displayName: 'Fixture' },
  contributions: [
    {
      id: 'fixture-host',
      type: 'provider-integration',
      runtime: 'desktop',
      entry: 'dist/host.js',
      provides: [{ id: 'harness.execution', version: '1.0.0' }],
      requires: [],
      configSchema: {
        type: 'object',
        properties: { model: { type: 'string' } },
        additionalProperties: false,
      },
      requestedPermissions: [],
    },
  ],
  lifecycle: {
    activation: 'startup',
    disable: 'restart-required',
    update: 'restart-required',
    uninstall: 'unsupported',
    dataDisposition: 'retain',
  },
}

describe('Manifest v0', () => {
  it('accepts only a valid Phase 0 package', () => {
    const parsePluginManifest = (contracts as Record<string, unknown>).parsePluginManifest as
      | ((input: unknown) => {
          success: boolean
          data?: unknown
          errors?: Array<{ path: string; code: string }>
        })
      | undefined

    expect(typeof parsePluginManifest).toBe('function')
    if (!parsePluginManifest) return

    expect(parsePluginManifest(validManifest)).toEqual({
      success: true,
      data: validManifest,
    })

    const invalidCases: Array<[string, unknown]> = [
      ['unknown field', { ...validManifest, source: 'download' }],
      ['bad package ID', { ...validManifest, id: 'Fixture_Package' }],
      ['bad SemVer', { ...validManifest, version: '1' }],
      ['bad VoiceClaw range', { ...validManifest, voiceclawVersionRange: 'latest' }],
      ['missing Feature', { ...validManifest, feature: undefined }],
      [
        'duplicate Contribution ID',
        {
          ...validManifest,
          contributions: [
            validManifest.contributions[0],
            { ...validManifest.contributions[0], type: 'desktop-service' },
          ],
        },
      ],
      [
        'unsupported category',
        {
          ...validManifest,
          contributions: [{ ...validManifest.contributions[0], type: 'relay-service' }],
        },
      ],
      [
        'absolute entry',
        {
          ...validManifest,
          contributions: [{ ...validManifest.contributions[0], entry: 'C:/secrets/host.js' }],
        },
      ],
      [
        'escaping entry',
        {
          ...validManifest,
          contributions: [{ ...validManifest.contributions[0], entry: '../host.js' }],
        },
      ],
      [
        'wrong lifecycle',
        {
          ...validManifest,
          lifecycle: { ...validManifest.lifecycle, disable: 'hot' },
        },
      ],
      ['embedded secret', { ...validManifest, apiKey: 'plaintext' }],
    ]

    for (const [label, input] of invalidCases) {
      const result = parsePluginManifest(input)
      expect(result.success, label).toBe(false)
      expect(result.errors?.length, label).toBeGreaterThan(0)
    }
  })
})

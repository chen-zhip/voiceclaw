import { describe, expect, it } from 'vitest'

describe('Codex Capability Profile', () => {
  it('selects the exactly verified profile for 0.153.4', async () => {
    const { parseCodexVersion, selectCodexCapabilityProfile } = await import('./codex-profile.js')

    expect(parseCodexVersion('codex-cli 0.153.4')).toBe('0.153.4')
    const selection = selectCodexCapabilityProfile('0.153.4')
    expect(selection.status).toBe('exact')
    expect(selection.warning).toBeNull()
    expect(selection.profile.version).toBe('0.153.4')
    expect(selection.profile.operations).toEqual([
      'provider.describe',
      'thread.ensure',
      'turn.start',
      'turn.cancel',
    ])
    expect(selection.profile.deferred).toEqual([
      'history-import',
      'native-tui-handoff',
      'approval-route',
      'advanced-recovery',
    ])
    expect(selection.profile.processDefiningSettings).toEqual([
      'executablePath',
      'accountRef',
      'model',
      'approvalPolicy',
    ])
  })

  it('keeps a persistent unverified warning for a nearby version', async () => {
    const { selectCodexCapabilityProfile } = await import('./codex-profile.js')

    const selection = selectCodexCapabilityProfile('0.153.7')
    expect(selection.status).toBe('unverified')
    expect(selection.profile.version).toBe('0.153.4')
    expect(selection.warning).toEqual({
      code: 'unverified-codex-version',
      detectedVersion: '0.153.7',
      profileVersion: '0.153.4',
      message: 'Codex 0.153.7 is not an exactly verified Capability Profile',
    })
    expect(selectCodexCapabilityProfile('0.153.7').warning).toEqual(selection.warning)
  })

  it('rejects a version outside the verified profile line', async () => {
    const { selectCodexCapabilityProfile } = await import('./codex-profile.js')

    expect(() => selectCodexCapabilityProfile('0.154.0')).toThrowError(
      expect.objectContaining({ code: 'unsupported_codex_version' })
    )
    expect(() => selectCodexCapabilityProfile('0.152.9')).toThrowError(
      expect.objectContaining({ code: 'unsupported_codex_version' })
    )
    expect(() => selectCodexCapabilityProfile('not-a-version')).toThrowError(
      expect.objectContaining({ code: 'unsupported_codex_version' })
    )
  })
})

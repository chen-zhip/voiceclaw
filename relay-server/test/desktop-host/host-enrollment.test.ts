import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ControlStateStore } from '../../src/plugin-kernel/control-state-store.js'
import { RemoteHostEnrollmentService } from '../../src/desktop-host/host-enrollment.js'

const relayAuthority = { kind: 'relay-authority' as const, id: 'desktop-host-gateway' }

describe('remote Host enrollment', () => {
  it('permits only one active Host registration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-single-host-'))
    const store = await ControlStateStore.open(join(directory, 'control-state.json'), {
      requester: relayAuthority,
    })
    const secrets = ['token-1', 'token-2', 'credential-1', 'credential-2']
    const enrollment = new RemoteHostEnrollmentService(store, {
      createSecret: () => secrets.shift() as string,
      createHostId: () => `host-${secrets.length}`,
      authorizeOwner: () => true,
    })
    const first = await enrollment.issueToken({
      principal: { kind: 'user', id: 'owner-1' },
      installationId: 'installation-1',
    })
    const second = await enrollment.issueToken({
      principal: { kind: 'user', id: 'owner-1' },
      installationId: 'installation-2',
    })

    await expect(enrollment.exchangeToken({ token: first.token })).resolves.toMatchObject({
      credential: 'credential-1',
    })
    await expect(enrollment.exchangeToken({ token: second.token })).rejects.toMatchObject({
      code: 'host_limit_reached',
    })
    expect(store.read().hosts).toHaveLength(1)
  })

  it('preserves typed Host authority records', async () => {
    const { RemoteHostEnrollmentService } =
      await import('../../src/desktop-host/host-enrollment.js')
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-host-reregistration-'))
    const path = join(directory, 'control-state.json')
    const store = await ControlStateStore.open(path, { requester: relayAuthority })
    await store.commit((state) => ({
      ...state,
      hosts: [{ id: 'revoked-legacy-host', revoked: true }],
    }))
    const enrollment = new RemoteHostEnrollmentService(store, {
      now: () => Date.parse('2026-09-11T00:00:00.000Z'),
      createSecret: (() => {
        const secrets = ['replacement-enrollment-token', 'replacement-host-credential']
        return () => secrets.shift() as string
      })(),
      createHostId: () => 'replacement-host',
      authorizeOwner: () => true,
    })

    const issued = await enrollment.issueToken({
      principal: { kind: 'user', id: 'owner-1' },
      installationId: 'desktop-installation-1',
    })
    await enrollment.exchangeToken({ token: issued.token })

    const reopened = await ControlStateStore.open(path, { requester: relayAuthority })
    expect(reopened.read().hosts).toEqual([
      { id: 'revoked-legacy-host', revoked: true },
      expect.objectContaining({
        id: 'replacement-host',
        installationId: 'desktop-installation-1',
        authorityVersion: 1,
        revoked: false,
      }),
    ])
  })

  it('exchanges one enrollment token once', async () => {
    const { RemoteHostEnrollmentService } =
      await import('../../src/desktop-host/host-enrollment.js')
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-host-enrollment-'))
    const path = join(directory, 'control-state.json')
    const store = await ControlStateStore.open(path, { requester: relayAuthority })
    let now = Date.parse('2026-09-11T00:00:00.000Z')
    const generatedSecrets = ['enrollment-secret', 'host-credential', 'expiring-enrollment-secret']
    const enrollment = new RemoteHostEnrollmentService(store, {
      now: () => now,
      createSecret: () => generatedSecrets.shift() as string,
      createHostId: () => 'host-installation-1',
      authorizeOwner: (principal) => principal.kind === 'user' && principal.id === 'owner-1',
      enrollmentTtlMs: 60_000,
    })

    await expect(
      enrollment.issueToken({
        principal: { kind: 'client', id: 'not-owner' },
        installationId: 'desktop-installation-1',
      })
    ).rejects.toMatchObject({ code: 'owner_authorization_required' })

    const issued = await enrollment.issueToken({
      principal: { kind: 'user', id: 'owner-1' },
      installationId: 'desktop-installation-1',
    })
    expect(issued).toEqual({
      token: 'enrollment-secret',
      expiresAt: '2026-09-11T00:01:00.000Z',
    })

    const registered = await enrollment.exchangeToken({ token: issued.token })
    expect(registered).toEqual({
      hostId: 'host-installation-1',
      credential: 'host-credential',
    })
    await expect(enrollment.exchangeToken({ token: issued.token })).rejects.toMatchObject({
      code: 'invalid_enrollment_token',
    })

    const reopened = await ControlStateStore.open(path, { requester: relayAuthority })
    expect(reopened.read().hosts).toEqual([
      {
        id: 'host-installation-1',
        installationId: 'desktop-installation-1',
        credentialVerifier:
          'sha256:290fdc4162039e0f5d9551490fb2ca3dc8a7adc9ac11e045383566713e3a19bc',
        credentialExpiresAt: null,
        enrollmentTokenVerifier:
          'sha256:ee61664868488406136af84cb408e1860e17dc40f295b1fd5dd65c9552403acc',
        enrolledAt: '2026-09-11T00:00:00.000Z',
        lastActivityAt: null,
        authorityVersion: 1,
        revoked: false,
      },
    ])
    expect(JSON.stringify(reopened.read())).not.toContain('enrollment-secret')
    expect(JSON.stringify(reopened.read())).not.toContain('host-credential')

    const expiring = await enrollment.issueToken({
      principal: { kind: 'user', id: 'owner-1' },
      installationId: 'desktop-installation-2',
    })
    now += 60_001
    await expect(enrollment.exchangeToken({ token: expiring.token })).rejects.toMatchObject({
      code: 'invalid_enrollment_token',
    })
    expect(store.read().hosts).toHaveLength(1)
  })
})

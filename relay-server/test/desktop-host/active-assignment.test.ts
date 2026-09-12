import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DesktopHostConnectionGateway } from '../../src/desktop-host/host-connection.js'
import { RemoteHostEnrollmentService } from '../../src/desktop-host/host-enrollment.js'
import { ControlStateStore } from '../../src/plugin-kernel/control-state-store.js'

const relayAuthority = { kind: 'relay-authority' as const, id: 'desktop-host-gateway' }

describe('Active Host Assignment', () => {
  it('selects only matching Provider and Workspace readiness', async () => {
    const { ActiveHostAssignmentService } =
      await import('../../src/desktop-host/active-assignment.js')
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-exact-host-assignment-'))
    const path = join(directory, 'control-state.json')
    const store = await ControlStateStore.open(path, { requester: relayAuthority })
    const secrets = ['enrollment-token', 'host-credential']
    const enrollment = new RemoteHostEnrollmentService(store, {
      createSecret: () => secrets.shift() as string,
      createHostId: () => 'host-1',
      authorizeOwner: () => true,
    })
    const token = await enrollment.issueToken({
      principal: { kind: 'user', id: 'owner-1' },
      installationId: 'installation-1',
    })
    const registered = await enrollment.exchangeToken({ token: token.token })
    const gateway = new DesktopHostConnectionGateway(store)
    const hostPrincipal = await gateway.admit({
      mode: 'remote',
      credential: { kind: 'host', value: registered.credential },
    })
    const assignments = new ActiveHostAssignmentService(store, gateway)
    const selection = {
      bindingId: 'binding-1',
      hostId: 'host-1',
      providerId: 'codex',
      workspaceBindingId: 'workspace-1',
    }

    await assignments.reportReadiness(hostPrincipal, {
      bindingId: 'binding-1',
      providerId: 'codex',
      workspaceBindingId: 'wrong-workspace',
      ready: true,
    })
    await expect(assignments.select(relayAuthority, selection)).rejects.toMatchObject({
      code: 'host_unavailable',
    })
    await assignments.reportReadiness(hostPrincipal, {
      bindingId: 'binding-1',
      providerId: 'wrong-provider',
      workspaceBindingId: 'workspace-1',
      ready: true,
    })
    await expect(assignments.select(relayAuthority, selection)).rejects.toMatchObject({
      code: 'host_unavailable',
    })
    await assignments.reportReadiness(hostPrincipal, {
      bindingId: 'binding-1',
      providerId: 'codex',
      workspaceBindingId: 'workspace-1',
      ready: true,
    })
    await expect(assignments.select(hostPrincipal, selection)).rejects.toMatchObject({
      code: 'relay_authority_required',
    })
    await expect(assignments.select(relayAuthority, selection)).resolves.toMatchObject({
      ...selection,
      generation: 1,
      status: 'ready',
    })
    await expect(assignments.select(relayAuthority, selection)).resolves.toMatchObject({
      ...selection,
      generation: 2,
      status: 'ready',
    })

    const reopened = await ControlStateStore.open(path, { requester: relayAuthority })
    const restarted = new ActiveHostAssignmentService(
      reopened,
      new DesktopHostConnectionGateway(reopened)
    )
    expect(restarted.inspect('binding-1')).toEqual({
      ...selection,
      generation: 2,
      status: 'offline',
    })
  })

  it('persists one Relay-owned assignment and fences reconnects', async () => {
    const { ActiveHostAssignmentService } =
      await import('../../src/desktop-host/active-assignment.js')
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-host-assignment-'))
    const path = join(directory, 'control-state.json')
    const store = await ControlStateStore.open(path, { requester: relayAuthority })
    const secrets = ['enrollment-token', 'host-credential']
    const enrollment = new RemoteHostEnrollmentService(store, {
      createSecret: () => secrets.shift() as string,
      createHostId: () => 'host-1',
      authorizeOwner: () => true,
    })
    const token = await enrollment.issueToken({
      principal: { kind: 'user', id: 'owner-1' },
      installationId: 'installation-1',
    })
    const registered = await enrollment.exchangeToken({ token: token.token })
    const gateway = new DesktopHostConnectionGateway(store)
    const hostPrincipal = await gateway.admit({
      mode: 'remote',
      credential: { kind: 'host', value: registered.credential },
    })
    const assignments = new ActiveHostAssignmentService(store, gateway)

    await expect(
      assignments.select(hostPrincipal, {
        bindingId: 'binding-1',
        hostId: 'host-1',
        providerId: 'codex',
        workspaceBindingId: 'workspace-1',
      })
    ).rejects.toMatchObject({ code: 'relay_authority_required' })
    await assignments.reportReadiness(hostPrincipal, {
      bindingId: 'binding-1',
      providerId: 'codex',
      workspaceBindingId: 'workspace-1',
      ready: true,
    })
    await expect(
      assignments.select(relayAuthority, {
        bindingId: 'binding-1',
        hostId: 'host-1',
        providerId: 'codex',
        workspaceBindingId: 'workspace-1',
      })
    ).resolves.toEqual({
      bindingId: 'binding-1',
      hostId: 'host-1',
      providerId: 'codex',
      workspaceBindingId: 'workspace-1',
      generation: 1,
      status: 'ready',
    })

    const reopened = await ControlStateStore.open(path, { requester: relayAuthority })
    const restartedGateway = new DesktopHostConnectionGateway(reopened)
    const restartedAssignments = new ActiveHostAssignmentService(reopened, restartedGateway)
    expect(restartedAssignments.inspect('binding-1')).toEqual({
      bindingId: 'binding-1',
      hostId: 'host-1',
      providerId: 'codex',
      workspaceBindingId: 'workspace-1',
      generation: 1,
      status: 'offline',
    })

    const reconnectedPrincipal = await restartedGateway.admit({
      mode: 'remote',
      credential: { kind: 'host', value: registered.credential },
    })
    await expect(
      restartedAssignments.authoritativeReconnect(relayAuthority, reconnectedPrincipal)
    ).resolves.toBe(2)
    expect(restartedAssignments.inspect('binding-1')).toMatchObject({
      hostId: 'host-1',
      generation: 2,
      status: 'unready',
    })
    await restartedAssignments.reportReadiness(reconnectedPrincipal, {
      bindingId: 'binding-1',
      providerId: 'codex',
      workspaceBindingId: 'workspace-1',
      ready: true,
    })
    expect(restartedAssignments.inspect('binding-1').status).toBe('ready')

    restartedAssignments.hostDisconnected(reconnectedPrincipal)
    expect(restartedAssignments.inspect('binding-1')).toMatchObject({
      hostId: 'host-1',
      generation: 2,
      status: 'offline',
    })
    expect(reopened.read().assignments).toEqual([
      {
        bindingId: 'binding-1',
        hostId: 'host-1',
        providerId: 'codex',
        workspaceBindingId: 'workspace-1',
        generation: 2,
      },
    ])
  })
})

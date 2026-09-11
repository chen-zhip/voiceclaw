import { mkdtemp, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as controlState from '../../src/plugin-kernel/control-state-store.js'

type Store = {
  read(): {
    revision: number
    hosts: Array<{ id: string; revoked: boolean }>
  }
  commit(
    mutate: (state: Record<string, unknown>) => Record<string, unknown>,
    options?: { expectedRevision?: number }
  ): Promise<{ revision: number }>
}

const relayAuthority = { kind: 'relay-authority' as const, id: 'kernel' }

describe('ControlStateStore', () => {
  it('keeps the last complete control state', async () => {
    const ControlStateStore = (controlState as Record<string, unknown>).ControlStateStore as
      | {
          open(
            path: string,
            options: {
              atomicReplace?: (temporaryPath: string, targetPath: string) => Promise<void>
              requester: typeof relayAuthority
            }
          ): Promise<Store>
        }
      | undefined

    expect(typeof ControlStateStore?.open).toBe('function')
    if (!ControlStateStore) return

    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-control-state-'))
    const path = join(directory, 'control-state.json')
    await expect(
      (ControlStateStore.open as (path: string) => Promise<Store>)(path)
    ).rejects.toMatchObject({ code: 'control_state_access_denied' })
    const store = await ControlStateStore.open(path, { requester: relayAuthority })
    const first = await store.commit((state) => ({
      ...state,
      grants: [
        {
          id: 'grant-1',
          principalId: 'routing',
          contractId: 'harness.execution',
          operation: 'turn.start',
          scope: { kind: 'workspace', id: 'workspace-1' },
          secretRefs: [],
          workspaceBindings: ['workspace-1'],
          revoked: false,
        },
      ],
    }))
    expect(first.revision).toBe(1)
    expect(
      (await ControlStateStore.open(path, { requester: relayAuthority })).read().revision
    ).toBe(1)

    const commits = await Promise.all([
      store.commit((state) => ({
        ...state,
        hosts: [...(state.hosts as unknown[]), { id: 'host-1', revoked: false }],
      })),
      store.commit((state) => ({
        ...state,
        hosts: [...(state.hosts as unknown[]), { id: 'host-2', revoked: false }],
      })),
    ])
    expect(commits.map((result) => result.revision)).toEqual([2, 3])
    expect(store.read().hosts.map((host) => host.id)).toEqual(['host-1', 'host-2'])

    await expect(store.commit((state) => state, { expectedRevision: 1 })).rejects.toMatchObject({
      code: 'stale_revision',
    })

    await expect(
      store.commit((state) => ({ ...state, grants: [{ id: 'incomplete' }] }))
    ).rejects.toMatchObject({ code: 'invalid_control_state' })
    expect(store.read().revision).toBe(3)

    const failingStore = await ControlStateStore.open(path, {
      requester: relayAuthority,
      atomicReplace: async () => {
        throw new Error('replace unavailable')
      },
    })
    await expect(
      failingStore.commit((state) => ({
        ...state,
        hosts: [...(state.hosts as unknown[]), { id: 'host-3', revoked: false }],
      }))
    ).rejects.toThrow('replace unavailable')

    const reopened = await ControlStateStore.open(path, {
      requester: relayAuthority,
      atomicReplace: rename,
    })
    expect(reopened.read().revision).toBe(3)
    expect(reopened.read().hosts.map((host) => host.id)).toEqual(['host-1', 'host-2'])
  })

  it('rejects product content and plugin records', async () => {
    const ControlStateStore = (controlState as Record<string, unknown>).ControlStateStore as {
      open(
        path: string,
        options: {
          allowedDirectory?: string
          requester?: { kind: 'relay-authority' | 'plugin'; id: string }
        }
      ): Promise<Store>
    }
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-control-boundary-'))
    const path = join(directory, 'control-state.json')
    const store = await ControlStateStore.open(path, {
      allowedDirectory: directory,
      requester: relayAuthority,
    })

    const forbiddenRecords = [
      { messages: [{ text: 'conversation' }] },
      { attachments: [{ path: 'image.png' }] },
      { semanticOutput: { text: 'answer' } },
      { memory: { content: 'remember this' } },
      { evidence: { payload: 'tool log' } },
      { pluginRecords: { plugin: 'arbitrary' } },
      { path: '../plugin-data/private.json' },
    ]
    for (const forbidden of forbiddenRecords) {
      await expect(store.commit((state) => ({ ...state, ...forbidden }))).rejects.toMatchObject({
        code: 'invalid_control_state',
      })
    }
    expect(store.read().revision).toBe(0)

    await expect(
      ControlStateStore.open(join(directory, '..', 'escaped.json'), {
        allowedDirectory: directory,
        requester: relayAuthority,
      })
    ).rejects.toMatchObject({ code: 'invalid_control_state' })
    await expect(
      ControlStateStore.open(path, {
        allowedDirectory: directory,
        requester: { kind: 'plugin', id: 'voiceclaw-fixture' },
      })
    ).rejects.toMatchObject({ code: 'control_state_access_denied' })
  })
})

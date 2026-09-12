import { mkdtemp, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ControlStateStore } from '../../src/plugin-kernel/control-state-store.js'

const relayAuthority = { kind: 'relay-authority' as const, id: 'harness-routing' }

describe('Conversation Thread Mapping', () => {
  it('persists only a content-free Thread Mapping', async () => {
    const mappingModule = await import('../../src/harness-execution/thread-mapping.js').catch(
      () => ({})
    )
    const ConversationThreadMappings = Reflect.get(mappingModule, 'ConversationThreadMappings')

    expect(ConversationThreadMappings).toBeTypeOf('function')

    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-thread-mapping-'))
    const path = join(directory, 'control-state.json')
    const store = await ControlStateStore.open(path, { requester: relayAuthority })
    const mappings = new ConversationThreadMappings(store)
    const binding = {
      conversationId: 'conversation-1',
      providerId: 'provider-1',
      workspaceId: 'workspace-1',
    }
    const createThread = vi.fn(async () => 'thread-1')

    const created = await mappings.ensure(binding, createThread)
    const reused = await mappings.ensure(binding, createThread)

    expect(created).toEqual({ ...binding, threadId: 'thread-1', status: 'active' })
    expect(reused).toEqual(created)
    expect(createThread).toHaveBeenCalledTimes(1)
    expect(Object.keys(store.read().threadMappings[0]).sort()).toEqual([
      'conversationId',
      'providerId',
      'status',
      'threadId',
      'workspaceBindingId',
    ])

    const reopenedStore = await ControlStateStore.open(path, { requester: relayAuthority })
    const reopened = new ConversationThreadMappings(reopenedStore)
    expect(reopened.find(binding)).toEqual(created)

    const failingStore = await ControlStateStore.open(path, {
      requester: relayAuthority,
      atomicReplace: async () => {
        throw new Error('replace unavailable')
      },
    })
    const failingMappings = new ConversationThreadMappings(failingStore)
    const uncommittedBinding = { ...binding, workspaceId: 'workspace-2' }
    await expect(
      failingMappings.ensure(uncommittedBinding, async () => 'thread-uncommitted')
    ).rejects.toThrow('replace unavailable')
    expect(failingMappings.find(uncommittedBinding)).toBeUndefined()

    const finalStore = await ControlStateStore.open(path, {
      requester: relayAuthority,
      atomicReplace: rename,
    })
    expect(new ConversationThreadMappings(finalStore).find(uncommittedBinding)).toBeUndefined()
  })

  it('forgets only the VoiceClaw mapping', async () => {
    const { ConversationThreadMappings } =
      await import('../../src/harness-execution/thread-mapping.js')
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-thread-lifecycle-'))
    const store = await ControlStateStore.open(join(directory, 'control-state.json'), {
      requester: relayAuthority,
    })
    const mappings = new ConversationThreadMappings(store)
    const bindings = [
      { conversationId: 'conversation-1', providerId: 'provider-disabled', workspaceId: 'ws-1' },
      { conversationId: 'conversation-1', providerId: 'host-offline', workspaceId: 'ws-2' },
      { conversationId: 'conversation-1', providerId: 'provider-updating', workspaceId: 'ws-3' },
      { conversationId: 'conversation-1', providerId: 'provider-ready', workspaceId: 'ws-deleted' },
      { conversationId: 'conversation-2', providerId: 'provider-ready', workspaceId: 'ws-4' },
    ]
    const providerThreads = new Set<string>()

    for (const [index, binding] of bindings.entries()) {
      await mappings.ensure(binding, async () => {
        const threadId = `provider-thread-${index + 1}`
        providerThreads.add(threadId)
        return threadId
      })
    }

    await mappings.markDormant(bindings[0], 'provider-unavailable')
    await mappings.markDormant(bindings[1], 'host-unavailable')
    await mappings.markDormant(bindings[2], 'provider-update')
    await mappings.markDormant(bindings[3], 'workspace-binding-deleted')

    expect(bindings.slice(0, 4).map((binding) => mappings.find(binding)?.status)).toEqual([
      'dormant',
      'dormant',
      'dormant',
      'dormant',
    ])

    await mappings.forget(bindings[0])
    expect(mappings.find(bindings[0])).toBeUndefined()
    expect(providerThreads.has('provider-thread-1')).toBe(true)

    await mappings.deleteConversation('conversation-1')
    expect(bindings.slice(0, 4).map((binding) => mappings.find(binding))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ])
    expect(mappings.find(bindings[4])).toMatchObject({
      conversationId: 'conversation-2',
      threadId: 'provider-thread-5',
      status: 'active',
    })
    expect(providerThreads).toEqual(
      new Set([
        'provider-thread-1',
        'provider-thread-2',
        'provider-thread-3',
        'provider-thread-4',
        'provider-thread-5',
      ])
    )
  })
})

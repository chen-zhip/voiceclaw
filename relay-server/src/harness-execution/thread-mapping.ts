import type { ControlStateStore } from '../plugin-kernel/control-state-store.js'

export interface ThreadMappingBinding {
  conversationId: string
  providerId: string
  workspaceId: string
}

export interface ConversationThreadMapping extends ThreadMappingBinding {
  threadId: string
  status: 'active' | 'dormant'
}

export type ThreadMappingDormancyReason =
  | 'provider-unavailable'
  | 'host-unavailable'
  | 'provider-update'
  | 'workspace-binding-deleted'

export class ConversationThreadMappings {
  constructor(private readonly store: ControlStateStore) {}

  find(binding: ThreadMappingBinding): ConversationThreadMapping | undefined {
    const mapping = this.store
      .read()
      .threadMappings.find(
        (candidate) =>
          candidate.conversationId === binding.conversationId &&
          candidate.providerId === binding.providerId &&
          candidate.workspaceBindingId === binding.workspaceId
      )
    return mapping
      ? {
          conversationId: mapping.conversationId,
          providerId: mapping.providerId,
          workspaceId: mapping.workspaceBindingId,
          threadId: mapping.threadId,
          status: mapping.status ?? 'active',
        }
      : undefined
  }

  async ensure(
    binding: ThreadMappingBinding,
    createThread: () => Promise<string>
  ): Promise<ConversationThreadMapping> {
    const existing = this.find(binding)
    if (existing) return existing

    const threadId = await createThread()
    await this.store.commit((state) => ({
      ...state,
      threadMappings: [
        ...state.threadMappings,
        {
          conversationId: binding.conversationId,
          providerId: binding.providerId,
          workspaceBindingId: binding.workspaceId,
          threadId,
          status: 'active',
        },
      ],
    }))
    return { ...binding, threadId, status: 'active' }
  }

  async markDormant(
    binding: ThreadMappingBinding,
    reason: ThreadMappingDormancyReason
  ): Promise<void> {
    void reason
    if (!this.find(binding)) return
    await this.store.commit((state) => ({
      ...state,
      threadMappings: state.threadMappings.map((mapping) =>
        matches(mapping, binding) ? { ...mapping, status: 'dormant' } : mapping
      ),
    }))
  }

  async forget(binding: ThreadMappingBinding): Promise<boolean> {
    if (!this.find(binding)) return false
    await this.store.commit((state) => ({
      ...state,
      threadMappings: state.threadMappings.filter((mapping) => !matches(mapping, binding)),
    }))
    return true
  }

  async deleteConversation(conversationId: string): Promise<number> {
    const removed = this.store
      .read()
      .threadMappings.filter((mapping) => mapping.conversationId === conversationId).length
    if (removed === 0) return 0
    await this.store.commit((state) => ({
      ...state,
      threadMappings: state.threadMappings.filter(
        (mapping) => mapping.conversationId !== conversationId
      ),
    }))
    return removed
  }
}

function matches(
  mapping: { conversationId: string; providerId: string; workspaceBindingId: string },
  binding: ThreadMappingBinding
): boolean {
  return (
    mapping.conversationId === binding.conversationId &&
    mapping.providerId === binding.providerId &&
    mapping.workspaceBindingId === binding.workspaceId
  )
}

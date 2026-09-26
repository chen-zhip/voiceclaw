import { useCallback, useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import {
  PageContentColumn,
  PageHeader,
  PageScrollBody,
  PageSurface,
} from '../components/layout/PageLayout'
import { useConversationContext } from '../lib/conversation-context'
import {
  deleteAllConversations,
  deleteConversation,
  getConversationsWithPreview,
  type ConversationWithPreview,
} from '../lib/db'

type ConversationSection = {
  title: string
  data: ConversationWithPreview[]
}

type HistoryPageProps = {
  isVisible: boolean
  onNavigateToChat: () => void
}

export function HistoryPage({ isVisible, onNavigateToChat }: HistoryPageProps) {
  const [conversations, setConversations] = useState<ConversationWithPreview[]>([])
  const { selectConversation } = useConversationContext()

  const sections = useMemo(() => groupConversationsByDate(conversations), [conversations])

  const loadConversations = useCallback(async () => {
    const result = await getConversationsWithPreview()
    setConversations(result)
  }, [])

  // Initial load
  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  // Refresh immediately when the tab becomes visible so the list is never stale
  useEffect(() => {
    if (isVisible) {
      loadConversations()
    }
  }, [isVisible, loadConversations])

  // Poll every 10s while the tab is visible to stay fresh during active use
  useEffect(() => {
    if (!isVisible) return
    const interval = setInterval(loadConversations, 10_000)
    return () => clearInterval(interval)
  }, [isVisible, loadConversations])

  const handleTap = useCallback(
    (id: number) => {
      selectConversation(id)
      onNavigateToChat()
    },
    [selectConversation, onNavigateToChat]
  )

  const handleDelete = useCallback(
    async (id: number, title: string) => {
      if (!confirm(`Delete "${title}"?`)) return
      await deleteConversation(id)
      loadConversations()
    },
    [loadConversations]
  )

  const handleClearAll = useCallback(async () => {
    if (
      !confirm(
        'This will permanently delete all conversations and messages. This cannot be undone.'
      )
    )
      return
    await deleteAllConversations()
    loadConversations()
  }, [loadConversations])

  return (
    <PageSurface accessibleName="Conversation history">
      <PageHeader>
        <PageContentColumn className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[var(--shell-text)]">
              History
            </h1>
            <p className="mt-1 text-sm text-[var(--shell-muted)]">
              {conversations.length} conversation{conversations.length === 1 ? '' : 's'}
            </p>
          </div>
          {conversations.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              className="text-destructive hover:text-destructive">
              <Trash2 size={14} className="mr-1" />
              Clear All
            </Button>
          )}
        </PageContentColumn>
      </PageHeader>

      <PageScrollBody>
        {conversations.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-[var(--shell-muted)]">
            <p className="text-lg text-[var(--shell-text)]">No conversations yet</p>
            <p className="mt-1 text-sm">Start a chat to see your history</p>
          </div>
        ) : (
          <div>
            {sections.map((section) => (
              <section
                key={section.title}
                className="mb-6"
                aria-labelledby={`history-${section.title}`}>
                <h2
                  id={`history-${section.title}`}
                  className="sticky top-0 z-10 bg-[var(--shell-workspace)] py-2 text-xs font-semibold tracking-wide text-[var(--shell-muted)] uppercase">
                  {section.title}
                </h2>
                <div className="divide-y divide-[var(--shell-border)] rounded-2xl border border-[var(--shell-border)] bg-[var(--shell-raised)]">
                  {section.data.map((conv) => {
                    const title = getDisplayTitle(conv)
                    return (
                      <div key={conv.id} className="group flex items-start gap-2 p-2">
                        <button
                          type="button"
                          aria-label={`Open ${title}`}
                          onClick={() => handleTap(conv.id)}
                          className="min-w-0 flex-1 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--shell-selected)] focus-visible:ring-2 focus-visible:ring-[var(--shell-signal)] focus-visible:outline-none">
                          <p className="truncate text-sm font-medium text-[var(--shell-text)]">
                            {title}
                          </p>
                          {conv.preview && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-[var(--shell-muted)]">
                              {conv.preview}
                            </p>
                          )}
                          <p className="mt-1 text-[11px] text-[var(--shell-muted)]">
                            {formatDate(conv.updated_at)}
                            {conv.message_count > 0 &&
                              ` · ${conv.message_count} message${conv.message_count === 1 ? '' : 's'}`}
                          </p>
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${title}`}
                          onClick={() => handleDelete(conv.id, title)}
                          className="hover:bg-destructive/10 hover:text-destructive mt-2 flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--shell-muted)] opacity-70 transition-colors group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--shell-signal)] focus-visible:outline-none">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </PageScrollBody>
    </PageSurface>
  )
}

// --- Helper Functions ---

function groupConversationsByDate(conversations: ConversationWithPreview[]): ConversationSection[] {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86_400_000

  const groups = new Map<string, ConversationWithPreview[]>()

  for (const conversation of conversations) {
    const label = getDateLabel(conversation.updated_at, todayStart, yesterdayStart)
    const existing = groups.get(label)
    if (existing) {
      existing.push(conversation)
    } else {
      groups.set(label, [conversation])
    }
  }

  return Array.from(groups, ([title, data]) => ({ title, data }))
}

function getDateLabel(timestamp: number, todayStart: number, yesterdayStart: number): string {
  if (timestamp >= todayStart) return 'Today'
  if (timestamp >= yesterdayStart) return 'Yesterday'

  return new Date(timestamp).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function getDisplayTitle(conversation: ConversationWithPreview): string {
  if (conversation.title && conversation.title !== 'New Conversation') {
    return conversation.title
  }
  if (conversation.preview) {
    return conversation.preview.length > 60
      ? conversation.preview.slice(0, 60) + '...'
      : conversation.preview
  }
  return 'New Conversation'
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

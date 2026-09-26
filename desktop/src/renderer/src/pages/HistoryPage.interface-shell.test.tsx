// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HistoryPage } from './HistoryPage'
import { ConversationProvider } from '../lib/conversation-context'
import { installRendererTestBoundaries } from '../test/renderer-test-boundaries'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('HistoryPage interface shell', () => {
  it('keeps history actions in the refreshed surface', async () => {
    const onNavigateToChat = vi.fn()
    installRendererTestBoundaries({
      conversationPreviews: [
        {
          id: 7,
          title: 'Project notes',
          preview: 'Continue the desktop refresh',
          message_count: 4,
          created_at: Date.now() - 60_000,
          updated_at: Date.now(),
        },
      ],
    })
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    )

    render(
      <ConversationProvider>
        <HistoryPage isVisible onNavigateToChat={onNavigateToChat} />
      </ConversationProvider>
    )

    const surface = await screen.findByRole('region', { name: 'Conversation history' })
    expect(within(surface).getByRole('heading', { name: 'History' })).toBeTruthy()
    expect(within(surface).getByText('1 conversation')).toBeTruthy()

    fireEvent.click(within(surface).getByRole('button', { name: /Open Project notes/ }))
    expect(onNavigateToChat).toHaveBeenCalledOnce()

    const getConversations = window.electronAPI.db.getConversationsWithPreview as ReturnType<
      typeof vi.fn
    >
    getConversations.mockResolvedValueOnce([])
    fireEvent.click(within(surface).getByRole('button', { name: 'Delete Project notes' }))
    await waitFor(() => expect(window.electronAPI.db.deleteConversation).toHaveBeenCalledWith(7))
    expect(await screen.findByText('No conversations yet')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Conversation history' })).toBeTruthy()
  })
})

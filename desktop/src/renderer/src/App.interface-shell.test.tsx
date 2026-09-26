// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { installRendererTestBoundaries } from './test/renderer-test-boundaries'

afterEach(cleanup)

describe('App interface shell', () => {
  it('preserves Chat while navigating', async () => {
    installRendererTestBoundaries({
      settings: { voice_mode: 'direct' },
      conversation: {
        id: 1,
        title: 'Existing conversation',
        created_at: 1,
        updated_at: 1,
      },
      messages: [
        {
          id: 1,
          conversation_id: 1,
          role: 'assistant',
          content: 'Keep this visible',
          created_at: 1,
          stt_latency_ms: null,
          llm_latency_ms: null,
          tts_latency_ms: null,
          stt_provider: null,
          llm_provider: null,
          tts_provider: null,
        },
      ],
    })
    render(<App />)

    const chatView = await screen.findByRole('region', { name: 'Chat view' })
    await within(chatView).findByText('Keep this visible')
    const composer = within(chatView).getByRole('textbox', { name: 'Type a message' })
    fireEvent.change(composer, { target: { value: 'Draft survives navigation' } })

    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    const historyView = screen.getByRole('region', { name: 'History view' })
    expect(chatView.hidden).toBe(true)
    expect(historyView.hidden).toBe(false)
    expect(screen.getByRole('button', { name: 'History' }).getAttribute('aria-current')).toBe(
      'page'
    )

    fireEvent.keyDown(window, { key: 'n', ctrlKey: true })

    fireEvent.keyDown(window, { key: '1', ctrlKey: true })
    await waitFor(() => expect(chatView.hidden).toBe(false))
    expect(within(chatView).getByText('Keep this visible')).toBeTruthy()
    expect(
      (within(chatView).getByRole('textbox', { name: 'Type a message' }) as HTMLTextAreaElement)
        .value
    ).toBe('Draft survives navigation')
    expect(screen.getByRole('button', { name: 'Chat' }).getAttribute('aria-current')).toBe('page')
  })

  it('starts a new chat from the primary navigation', async () => {
    installRendererTestBoundaries({ settings: { voice_mode: 'direct' } })
    render(<App />)

    const chatView = await screen.findByRole('region', { name: 'Chat view' })
    const composer = within(chatView).getByRole('textbox', { name: 'Type a message' })
    fireEvent.change(composer, { target: { value: 'Discard this draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'History' }))

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))

    await waitFor(() => expect(chatView.hidden).toBe(false))
    expect(
      (within(chatView).getByRole('textbox', { name: 'Type a message' }) as HTMLTextAreaElement)
        .value
    ).toBe('')
  })
})

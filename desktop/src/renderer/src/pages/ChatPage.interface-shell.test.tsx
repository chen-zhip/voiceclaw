// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChatPage } from './ChatPage'
import { installRendererTestBoundaries } from '../test/renderer-test-boundaries'
import type { Message } from '../lib/db'

afterEach(cleanup)

const messages: Message[] = [
  {
    id: 1,
    conversation_id: 7,
    role: 'user',
    content: 'Workspace question',
    created_at: 1,
    stt_latency_ms: null,
    llm_latency_ms: null,
    tts_latency_ms: null,
    stt_provider: null,
    llm_provider: null,
    tts_provider: null,
  },
  {
    id: 2,
    conversation_id: 7,
    role: 'assistant',
    content: 'Workspace answer',
    created_at: 2,
    stt_latency_ms: null,
    llm_latency_ms: null,
    tts_latency_ms: null,
    stt_provider: null,
    llm_provider: null,
    tts_provider: null,
  },
]

describe('ChatPage interface shell', () => {
  it('keeps transcript and composer in one workspace', async () => {
    installRendererTestBoundaries({
      conversation: { id: 7, title: 'Workspace', created_at: 1, updated_at: 2 },
      messages,
      settings: { voice_mode: 'direct' },
    })

    render(<ChatPage />)

    const workspace = await screen.findByRole('region', { name: 'Conversation workspace' })
    const transcript = within(workspace).getByRole('log', { name: 'Conversation transcript' })
    const composer = within(workspace).getByRole('form', { name: 'Message composer' })
    expect(within(transcript).getByText('Workspace question')).toBeTruthy()
    expect(within(transcript).getByText('Workspace answer')).toBeTruthy()
    expect(within(composer).getByRole('textbox', { name: 'Type a message' })).toBeTruthy()
    expect(within(composer).getByRole('button', { name: 'Attach an image' })).toBeTruthy()
  })

  it('keeps active voice controls reachable in the dock', async () => {
    const { webSockets } = installRendererTestBoundaries({
      conversation: { id: 7, title: 'Workspace', created_at: 1, updated_at: 2 },
      messages,
      settings: {
        voice_mode: 'direct',
        realtime_server_url: 'ws://relay.test',
        realtime_api_key: 'test-key',
      },
    })

    render(<ChatPage />)
    const composer = await screen.findByRole('form', { name: 'Message composer' })
    fireEvent.click(within(composer).getByRole('button', { name: 'Start Call' }))
    await waitFor(() => expect(webSockets).toHaveLength(1))
    webSockets[0].emit({ type: 'session.ready' })

    const mute = await within(composer).findByRole('button', { name: 'Mute microphone' })
    expect(within(composer).getByRole('button', { name: 'Share screen' })).toBeTruthy()
    expect(within(composer).getByRole('button', { name: 'Open agent volume slider' })).toBeTruthy()
    expect(within(composer).getByRole('button', { name: 'End call' })).toBeTruthy()

    fireEvent.click(mute)
    expect(within(composer).getByRole('button', { name: 'Unmute microphone' })).toBeTruthy()
  })

  it('keeps conversation affordances visible as the dock grows', async () => {
    const { attachmentPickImage } = installRendererTestBoundaries({
      conversation: { id: 7, title: 'Workspace', created_at: 1, updated_at: 2 },
      messages,
      attachmentPickResult: {
        ok: true,
        file: {
          base64: 'aW1hZ2U=',
          mime: 'image/png',
          byteSize: 5,
          originalName: 'reference.png',
        },
      },
      settings: {
        voice_mode: 'stt-tts-harness',
        realtime_server_url: 'ws://relay.test',
        realtime_api_key: 'test-key',
      },
    })

    render(<ChatPage />)
    const workspace = await screen.findByRole('region', { name: 'Conversation workspace' })
    const transcript = within(workspace).getByRole('log', { name: 'Conversation transcript' })
    const composer = within(workspace).getByRole('form', { name: 'Message composer' })
    const textbox = within(composer).getByRole('textbox', { name: 'Type a message' })
    const longInput = `First line\n${'A longer follow-up line. '.repeat(12)}`

    fireEvent.change(textbox, { target: { value: longInput } })
    fireEvent.click(within(composer).getByRole('button', { name: 'Attach an image' }))
    expect(await within(composer).findByRole('img', { name: 'reference.png' })).toBeTruthy()
    expect((textbox as HTMLTextAreaElement).value).toBe(longInput)

    attachmentPickImage.mockResolvedValueOnce({ ok: false, error: 'Image could not be read' })
    fireEvent.click(within(composer).getByRole('button', { name: 'Attach an image' }))
    expect((await within(composer).findByRole('alert')).textContent).toContain(
      'Image could not be read'
    )

    fireEvent.click(within(composer).getByRole('button', { name: 'Send message' }))
    expect(
      await within(transcript).findByRole('status', { name: 'Waiting for AI output' })
    ).toBeTruthy()
    expect(within(workspace).getAllByRole('log', { name: 'Conversation transcript' })).toHaveLength(
      1
    )
    expect(within(workspace).getByRole('form', { name: 'Message composer' }).hidden).toBe(false)
  })
})

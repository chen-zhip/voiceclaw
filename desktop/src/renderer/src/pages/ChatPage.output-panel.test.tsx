// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPage } from './ChatPage'
import { installRendererTestBoundaries } from '../test/renderer-test-boundaries'
import type { Message } from '../lib/db'

const messages: Message[] = [
  {
    id: 1,
    conversation_id: 7,
    role: 'user',
    content: '用户问题',
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
    content: 'AI 回复',
    created_at: 2,
    stt_latency_ms: null,
    llm_latency_ms: null,
    tts_latency_ms: null,
    stt_provider: null,
    llm_provider: null,
    tts_provider: null,
  },
]

afterEach(cleanup)

describe('ChatPage STT/TTS output panel', () => {
  it('selects idle transcript presentation', async () => {
    const { settings } = installRendererTestBoundaries({
      conversation: { id: 7, title: 'History', created_at: 1, updated_at: 2 },
      messages,
      settings: { voice_mode: 'stt-tts-harness' },
    })

    const page = render(<ChatPage isActive />)
    const panel = await screen.findByRole('region', { name: 'AI output' })
    const user = screen.getByText('用户问题')
    expect(user.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    page.rerender(<ChatPage isActive={false} />)
    settings.voice_mode = 'direct'
    page.rerender(<ChatPage isActive />)

    await screen.findByText('AI 回复')
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'AI output' })).toBeNull()
    })
  })

  it('retains session presentation', async () => {
    const { settings, webSockets } = installRendererTestBoundaries({
      conversation: { id: 7, title: 'History', created_at: 1, updated_at: 2 },
      messages,
      settings: {
        voice_mode: 'direct',
        realtime_server_url: 'ws://relay.test',
        harness_provider_id: 'codex',
        harness_workspace_binding_id: 'workspace-1',
        harness_binding_id: 'binding-1',
        harness_stt_provider: 'stt-1',
        harness_tts_provider: 'tts-1',
        harness_id: 'codex',
      },
    })
    render(<ChatPage />)
    await screen.findByText('AI 回复')
    expect(screen.queryByRole('region', { name: 'AI output' })).toBeNull()

    settings.voice_mode = 'stt-tts-harness'
    fireEvent.click(screen.getByRole('button', { name: 'Start Call' }))
    await screen.findByRole('region', { name: 'AI output' })
    await waitFor(() => expect(webSockets).toHaveLength(1))

    webSockets[0].emit({ type: 'session.ready' })
    settings.voice_mode = 'direct'
    webSockets[0].disconnect()
    expect(screen.getByRole('region', { name: 'AI output' })).toBeTruthy()

    const endRequest = window.electronAPI.callBar?.onEndCallRequest as ReturnType<typeof vi.fn>
    endRequest.mock.calls[0][0]()
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'AI output' })).toBeNull()
    })
  })

  it('finalizes streamed panel text once', async () => {
    const { messages: storedMessages, webSockets } = installRendererTestBoundaries({
      conversation: { id: 7, title: 'History', created_at: 1, updated_at: 2 },
      messages,
      settings: {
        voice_mode: 'stt-tts-harness',
        realtime_server_url: 'ws://relay.test',
        harness_provider_id: 'codex',
        harness_workspace_binding_id: 'workspace-1',
        harness_binding_id: 'binding-1',
        harness_stt_provider: 'stt-1',
        harness_tts_provider: 'tts-1',
        harness_id: 'codex',
      },
    })
    render(<ChatPage />)
    await screen.findByRole('region', { name: 'AI output' })
    fireEvent.click(screen.getByRole('button', { name: 'Start Call' }))
    await waitFor(() => expect(webSockets).toHaveLength(1))

    webSockets[0].emit({ type: 'transcript.delta', role: 'assistant', text: '你好' })
    webSockets[0].emit({ type: 'transcript.delta', role: 'assistant', text: '，世界' })
    const streamed = await screen.findByText('你好，世界')
    expect(streamed.closest('[role="region"]')?.getAttribute('aria-label')).toBe('AI output')

    const getMessages = window.electronAPI.db.getMessages as ReturnType<typeof vi.fn>
    const callsBeforeFinalization = getMessages.mock.calls.length
    let finishReload!: (value: Message[]) => void
    const pendingReload = new Promise<Message[]>((resolve) => {
      finishReload = resolve
    })
    getMessages.mockImplementationOnce(() => pendingReload)
    webSockets[0].emit({ type: 'transcript.done', role: 'assistant', text: '你好，世界' })
    await waitFor(() =>
      expect(getMessages.mock.calls.length).toBeGreaterThan(callsBeforeFinalization)
    )
    expect(screen.getAllByText('你好，世界')).toHaveLength(1)

    finishReload(storedMessages)
    await waitFor(() => expect(screen.getAllByText('你好，世界')).toHaveLength(1))
  })

  it('keeps public Harness output in the panel after completion and the next turn', async () => {
    const { messages: storedMessages, webSockets } = installRendererTestBoundaries({
      conversation: { id: 7, title: 'History', created_at: 1, updated_at: 2 },
      messages,
      settings: {
        voice_mode: 'stt-tts-harness',
        realtime_server_url: 'ws://relay.test',
        harness_provider_id: 'codex',
        harness_workspace_binding_id: 'workspace-1',
        harness_binding_id: 'binding-1',
        harness_stt_provider: 'stt-1',
        harness_tts_provider: 'tts-1',
        harness_id: 'codex',
      },
    })
    const getMessages = window.electronAPI.db.getMessages as ReturnType<typeof vi.fn>
    getMessages.mockImplementation(() => Promise.resolve([...storedMessages]))
    render(<ChatPage />)
    await screen.findByRole('region', { name: 'AI output' })
    fireEvent.click(screen.getByRole('button', { name: 'Start Call' }))
    await waitFor(() => expect(webSockets).toHaveLength(1))
    webSockets[0].emit({ type: 'session.ready' })

    webSockets[0].emit({
      type: 'harness.semantic-output',
      classification: 'public-screen',
      text: '公开',
    })
    webSockets[0].emit({
      type: 'harness.semantic-output',
      classification: 'public-screen',
      text: '回复',
    })
    const streamed = await screen.findByText('公开回复')
    expect(streamed.closest('[role="region"]')?.getAttribute('aria-label')).toBe('AI output')

    webSockets[0].emit({
      type: 'harness.terminal',
      classification: 'terminal',
      outcome: { outcome: 'completed' },
    })
    webSockets[0].emit({ type: 'turn.started' })

    const addMessage = window.electronAPI.db.addMessage as ReturnType<typeof vi.fn>
    await waitFor(() => expect(addMessage).toHaveBeenCalledTimes(1))
    expect(addMessage.mock.calls[0].slice(0, 3)).toEqual([7, 'assistant', '公开回复'])
    await waitFor(() => {
      const visible = screen.getByText('公开回复')
      expect(visible.closest('[role="region"]')?.getAttribute('aria-label')).toBe('AI output')
    })
  })

  it('shows an actionable speech failure without hiding public text', async () => {
    const { webSockets } = installRendererTestBoundaries({
      conversation: { id: 7, title: 'History', created_at: 1, updated_at: 2 },
      messages,
      settings: {
        voice_mode: 'stt-tts-harness',
        realtime_server_url: 'ws://relay.test',
        harness_provider_id: 'codex',
        harness_workspace_binding_id: 'workspace-1',
        harness_binding_id: 'binding-1',
        harness_stt_provider: 'stt-1',
        harness_tts_provider: 'tts-1',
        harness_id: 'codex',
      },
    })
    render(<ChatPage />)
    await screen.findByRole('region', { name: 'AI output' })
    fireEvent.click(screen.getByRole('button', { name: 'Start Call' }))
    await waitFor(() => expect(webSockets).toHaveLength(1))
    webSockets[0].emit({ type: 'session.ready' })
    webSockets[0].emit({
      type: 'harness.semantic-output',
      classification: 'public-screen',
      text: '屏幕仍可阅读',
    })
    webSockets[0].emit({
      type: 'harness.tts-failed',
      message: 'Speech playback unavailable. Check the configured TTS service, then retry.',
    })

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Speech playback unavailable. Check the configured TTS service, then retry.'
    )
    expect(screen.getByText('屏幕仍可阅读')).toBeTruthy()
  })

  it('warns when a dispatched Harness turn has an unknown outcome', async () => {
    const { webSockets } = installRendererTestBoundaries({
      conversation: { id: 7, title: 'History', created_at: 1, updated_at: 2 },
      messages,
      settings: {
        voice_mode: 'stt-tts-harness',
        realtime_server_url: 'ws://relay.test',
        harness_provider_id: 'codex',
        harness_workspace_binding_id: 'workspace-1',
        harness_binding_id: 'binding-1',
        harness_stt_provider: 'stt-1',
        harness_tts_provider: 'tts-1',
        harness_id: 'codex',
      },
    })
    render(<ChatPage />)
    await screen.findByRole('region', { name: 'AI output' })
    fireEvent.click(screen.getByRole('button', { name: 'Start Call' }))
    await waitFor(() => expect(webSockets).toHaveLength(1))
    webSockets[0].emit({ type: 'session.ready' })
    webSockets[0].emit({
      type: 'harness.terminal',
      classification: 'terminal',
      outcome: { outcome: 'outcome-unknown' },
    })

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Turn outcome is unknown. Check the Codex thread before retrying; this turn will not replay automatically.'
    )
  })

  it('lets the user cancel an active Harness turn without ending the call', async () => {
    const { webSockets } = installRendererTestBoundaries({
      conversation: { id: 7, title: 'History', created_at: 1, updated_at: 2 },
      messages,
      settings: {
        voice_mode: 'stt-tts-harness',
        realtime_server_url: 'ws://relay.test',
        harness_provider_id: 'codex',
        harness_workspace_binding_id: 'workspace-1',
        harness_binding_id: 'binding-1',
        harness_stt_provider: 'stt-1',
        harness_tts_provider: 'tts-1',
        harness_id: 'codex',
      },
    })
    render(<ChatPage />)
    await screen.findByRole('region', { name: 'AI output' })
    fireEvent.click(screen.getByRole('button', { name: 'Start Call' }))
    await waitFor(() => expect(webSockets).toHaveLength(1))
    webSockets[0].emit({ type: 'session.ready' })
    webSockets[0].emit({ type: 'turn.started', turnId: 'turn-1' })
    webSockets[0].readyState = 1

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel turn' }))
    expect(webSockets[0].send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'response.cancel', reason: 'user_request' })
    )
    expect(screen.getByRole('button', { name: 'End call' })).toBeTruthy()

    webSockets[0].emit({
      type: 'harness.terminal',
      classification: 'terminal',
      outcome: { outcome: 'cancelled' },
    })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel turn' })).toBeNull())
  })

  it('shows waiting inline', async () => {
    const { settings } = installRendererTestBoundaries({
      conversation: { id: 7, title: 'History', created_at: 1, updated_at: 2 },
      messages,
      settings: {
        voice_mode: 'direct',
        realtime_server_url: 'ws://relay.test',
        realtime_api_key: 'test-key',
      },
    })
    render(<ChatPage />)
    await screen.findByText('AI 回复')
    expect(screen.queryByRole('region', { name: 'AI output' })).toBeNull()

    settings.voice_mode = 'stt-tts-harness'
    const composer = await screen.findByRole('textbox', { name: 'Type a message' })
    fireEvent.change(composer, { target: { value: '继续' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    const waiting = await screen.findByRole('status', { name: 'Waiting for AI output' })
    expect(waiting.closest('[role="region"]')?.getAttribute('aria-label')).toBe('AI output')
  })

  it('clears transient panel state', async () => {
    const { webSockets } = installRendererTestBoundaries({
      conversation: { id: 7, title: 'History', created_at: 1, updated_at: 2 },
      messages,
      settings: {
        voice_mode: 'stt-tts-harness',
        realtime_server_url: 'ws://relay.test',
        harness_provider_id: 'codex',
        harness_workspace_binding_id: 'workspace-1',
        harness_binding_id: 'binding-1',
        harness_stt_provider: 'stt-1',
        harness_tts_provider: 'tts-1',
        harness_id: 'codex',
      },
    })
    render(<ChatPage />)
    await screen.findByRole('region', { name: 'AI output' })
    fireEvent.click(screen.getByRole('button', { name: 'Start Call' }))
    await waitFor(() => expect(webSockets).toHaveLength(1))

    webSockets[0].emit({ type: 'transcript.delta', role: 'assistant', text: '临时内容' })
    await screen.findByText('临时内容')
    webSockets[0].emit({ type: 'error', message: 'Session interrupted', code: 500 })

    await waitFor(() => expect(screen.queryByText('临时内容')).toBeNull())
    expect(screen.getByText('AI 回复')).toBeTruthy()
  })

  it('clears transient panel state when the session ends normally', async () => {
    const { webSockets } = installRendererTestBoundaries({
      conversation: { id: 7, title: 'History', created_at: 1, updated_at: 2 },
      messages,
      settings: {
        voice_mode: 'stt-tts-harness',
        realtime_server_url: 'ws://relay.test',
        harness_provider_id: 'codex',
        harness_workspace_binding_id: 'workspace-1',
        harness_binding_id: 'binding-1',
        harness_stt_provider: 'stt-1',
        harness_tts_provider: 'tts-1',
        harness_id: 'codex',
      },
    })
    render(<ChatPage />)
    await screen.findByRole('region', { name: 'AI output' })
    fireEvent.click(screen.getByRole('button', { name: 'Start Call' }))
    await waitFor(() => expect(webSockets).toHaveLength(1))

    webSockets[0].emit({ type: 'transcript.delta', role: 'assistant', text: '正常结束前' })
    await screen.findByText('正常结束前')
    webSockets[0].emit({ type: 'session.ended', summary: 'done' })

    await waitFor(() => expect(screen.queryByText('正常结束前')).toBeNull())
  })

  it('clears transient panel state after reconnect attempts are exhausted', async () => {
    const { webSockets } = installRendererTestBoundaries({
      conversation: { id: 7, title: 'History', created_at: 1, updated_at: 2 },
      messages,
      settings: {
        voice_mode: 'stt-tts-harness',
        realtime_server_url: 'ws://relay.test',
        harness_provider_id: 'codex',
        harness_workspace_binding_id: 'workspace-1',
        harness_binding_id: 'binding-1',
        harness_stt_provider: 'stt-1',
        harness_tts_provider: 'tts-1',
        harness_id: 'codex',
      },
    })
    render(<ChatPage />)
    await screen.findByRole('region', { name: 'AI output' })
    fireEvent.click(screen.getByRole('button', { name: 'Start Call' }))
    await waitFor(() => expect(webSockets).toHaveLength(1))
    webSockets[0].emit({ type: 'transcript.delta', role: 'assistant', text: '重连前内容' })
    await screen.findByText('重连前内容')

    vi.useFakeTimers()
    try {
      for (const delay of [1000, 3000, 5000]) {
        webSockets.at(-1)?.disconnect()
        await act(() => vi.advanceTimersByTimeAsync(delay))
      }
      webSockets.at(-1)?.disconnect()
      await act(() => Promise.resolve())
      expect(screen.queryByText('重连前内容')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('copies only the selected panel reply', async () => {
    const neighboringReply: Message = { ...messages[1], id: 3, content: '相邻回复', created_at: 3 }
    const { clipboardWriteText } = installRendererTestBoundaries({
      conversation: { id: 7, title: 'History', created_at: 1, updated_at: 3 },
      messages: [...messages, neighboringReply],
      settings: { voice_mode: 'stt-tts-harness' },
    })
    render(<ChatPage />)
    const outputs = await screen.findAllByRole('region', { name: 'AI output' })

    fireEvent.contextMenu(outputs[0], { clientX: 20, clientY: 30 })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy' }))

    await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledWith('AI 回复'))
    expect(clipboardWriteText).not.toHaveBeenCalledWith('相邻回复')
  })

  it('preserves reading position while output grows', async () => {
    const { webSockets } = installRendererTestBoundaries({
      conversation: { id: 7, title: 'History', created_at: 1, updated_at: 2 },
      messages,
      settings: {
        voice_mode: 'stt-tts-harness',
        realtime_server_url: 'ws://relay.test',
        harness_provider_id: 'codex',
        harness_workspace_binding_id: 'workspace-1',
        harness_binding_id: 'binding-1',
        harness_stt_provider: 'stt-1',
        harness_tts_provider: 'tts-1',
        harness_id: 'codex',
      },
    })
    render(<ChatPage />)
    const panel = await screen.findByRole('region', { name: 'AI output' })
    const transcript = panel.parentElement as HTMLDivElement
    Object.defineProperties(transcript, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 100 },
    })
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>
    const scrollTo = HTMLElement.prototype.scrollTo as ReturnType<typeof vi.fn>
    scrollIntoView.mockClear()
    scrollTo.mockClear()
    fireEvent.scroll(transcript)

    fireEvent.click(screen.getByRole('button', { name: 'Start Call' }))
    await waitFor(() => expect(webSockets).toHaveLength(1))
    webSockets[0].emit({ type: 'transcript.delta', role: 'assistant', text: '新内容' })

    const jump = await screen.findByRole('button', { name: 'Jump to latest' })
    expect(scrollIntoView).not.toHaveBeenCalled()
    fireEvent.click(jump)
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' })
  })
})

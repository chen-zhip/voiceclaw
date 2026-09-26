// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssistantOutputPanel } from './AssistantOutputPanel'

afterEach(cleanup)

describe('AssistantOutputPanel', () => {
  it('renders completed assistant text', () => {
    render(
      <AssistantOutputPanel
        message={{
          id: 1,
          conversation_id: 1,
          role: 'assistant',
          content: '第一段\n\n第二段',
          created_at: 1,
          stt_latency_ms: null,
          llm_latency_ms: null,
          tts_latency_ms: null,
          stt_provider: null,
          llm_provider: null,
          tts_provider: null,
        }}
      />
    )

    const output = screen.getByRole('region', { name: 'AI output' })
    expect(output.textContent).toBe('第一段\n\n第二段')
    expect(output.className).toContain('w-full')
    expect(output.className).not.toContain('max-w-[80%]')
    expect(output.className).not.toContain('bg-card')
    expect(output.className).not.toContain('border')
  })

  it('preserves reply attachments and metadata', () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    render(
      <AssistantOutputPanel
        message={{
          id: 2,
          conversation_id: 1,
          role: 'assistant',
          content: '带图片的回复',
          created_at: 0,
          stt_latency_ms: 12,
          llm_latency_ms: 34,
          tts_latency_ms: 56,
          stt_provider: 'stt',
          llm_provider: 'llm',
          tts_provider: 'tts',
        }}
        attachments={[
          {
            id: 9,
            message_id: 2,
            kind: 'image',
            mime: 'image/png',
            storage: 'inline',
            data: 'aGVsbG8=',
            path: null,
            width: 10,
            height: 10,
            byte_size: 5,
            original_name: 'evidence.png',
            created_at: 0,
          },
        ]}
        showTimestamp
        showLatency
      />
    )

    const output = screen.getByRole('region', { name: 'AI output' })
    expect(output.querySelector('time')?.dateTime).toBe('1970-01-01T00:00:00.000Z')
    expect(screen.getByText(/STT 12ms \/ LLM 34ms \/ TTS 56ms/)).toBeTruthy()
    screen.getByRole('button', { name: 'evidence.png' }).click()
    expect(open).toHaveBeenCalledWith(
      'data:image/png;base64,aGVsbG8=',
      '_blank',
      'noopener,noreferrer'
    )
  })
})

// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MessageBubble } from '../components/MessageBubble'
import { installRendererTestBoundaries } from './renderer-test-boundaries'

afterEach(() => {
  document.body.replaceChildren()
})

describe('renderer test environment', () => {
  it('mounts a real renderer component', () => {
    render(
      <MessageBubble
        message={{
          id: 1,
          conversation_id: 1,
          role: 'assistant',
          content: 'Renderer ready',
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

    expect(screen.getByText('Renderer ready')).toBeTruthy()
  })

  it('controls viewport and preference media queries through browser boundaries', () => {
    const { viewport } = installRendererTestBoundaries({
      viewport: { width: 1200, colorScheme: 'light', reducedMotion: false },
    })

    const narrow = window.matchMedia('(max-width: 760px)')
    const dark = window.matchMedia('(prefers-color-scheme: dark)')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    expect([narrow.matches, dark.matches, reducedMotion.matches]).toEqual([false, false, false])

    viewport.resize(640)
    viewport.setColorScheme('dark')
    viewport.setReducedMotion(true)
    expect([narrow.matches, dark.matches, reducedMotion.matches]).toEqual([true, true, true])
  })
})

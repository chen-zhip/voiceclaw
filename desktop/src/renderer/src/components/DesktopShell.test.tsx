// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopNavigation } from './DesktopNavigation'
import { installRendererTestBoundaries } from '../test/renderer-test-boundaries'
import { useTheme, type Theme } from '../lib/use-theme'

afterEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.className = ''
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.colorScheme
})

describe('DesktopShell navigation', () => {
  it('navigates primary destinations', () => {
    const onTabChange = vi.fn()
    const onNewChat = vi.fn()
    render(
      <DesktopNavigation
        activeDestination="chat"
        onDestinationChange={onTabChange}
        onNewChat={onNewChat}
      />
    )

    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' })
    const chat = screen.getByRole('button', { name: 'Chat' })
    const history = screen.getByRole('button', { name: 'History' })
    expect(chat.getAttribute('aria-current')).toBe('page')
    expect(history.getAttribute('aria-current')).toBeNull()

    history.focus()
    fireEvent.click(history)
    expect(onTabChange).toHaveBeenCalledWith('history')
    expect(
      navigation.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_CONTAINED_BY
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(onNewChat).toHaveBeenCalledOnce()
  })

  it('keeps destinations reachable at narrow width', async () => {
    const { viewport } = installRendererTestBoundaries({ viewport: { width: 640 } })

    function Harness() {
      const [activeTab, setActiveTab] = useState<'chat' | 'history' | 'settings'>('chat')
      return (
        <>
          <DesktopNavigation
            activeDestination={activeTab}
            onDestinationChange={setActiveTab}
            onNewChat={() => setActiveTab('chat')}
          />
          <main>
            <button>Background action</button>
          </main>
        </>
      )
    }

    render(<Harness />)
    expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy()
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(true)

    const close = screen.getByRole('button', { name: 'Close navigation' })
    const settings = screen.getByRole('button', { name: 'Settings' })
    settings.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(settings)

    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(screen.getByRole('button', { name: 'History' }).getAttribute('aria-current')).toBe(
      'page'
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).toBeNull()

    await act(() => {
      viewport.resize(1200)
    })
    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'History' }).getAttribute('aria-current')).toBe(
      'page'
    )
  })

  it('keeps the narrow menu clear of macOS window controls', () => {
    installRendererTestBoundaries({ viewport: { width: 640 } })
    window.electronAPI.platform = 'darwin'

    render(
      <DesktopNavigation
        activeDestination="chat"
        onDestinationChange={() => {}}
        onNewChat={() => {}}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Open navigation' }).classList.contains('left-20')
    ).toBe(true)
  })

  it('preserves navigation states across themes', async () => {
    const { viewport } = installRendererTestBoundaries({
      viewport: { width: 1200, colorScheme: 'light' },
    })

    function Harness() {
      const [activeTab, setActiveTab] = useState<'chat' | 'history' | 'settings'>('history')
      const { setTheme } = useTheme()
      return (
        <>
          <DesktopNavigation
            activeDestination={activeTab}
            onDestinationChange={setActiveTab}
            onNewChat={() => setActiveTab('chat')}
          />
          {(['light', 'dark', 'system'] as Theme[]).map((theme) => (
            <button key={theme} onClick={() => setTheme(theme)}>
              Use {theme} theme
            </button>
          ))}
        </>
      )
    }

    render(<Harness />)
    const history = screen.getByRole('button', { name: 'History' })
    history.focus()
    expect(history.getAttribute('aria-current')).toBe('page')

    fireEvent.click(screen.getByRole('button', { name: 'Use dark theme' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
    expect(document.documentElement.dataset.colorScheme).toBe('dark')
    expect(history.getAttribute('aria-current')).toBe('page')

    fireEvent.click(screen.getByRole('button', { name: 'Use system theme' }))
    await act(() => viewport.setColorScheme('dark'))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('system'))
    expect(document.documentElement.dataset.colorScheme).toBe('dark')

    await act(() => viewport.setColorScheme('light'))
    await waitFor(() => expect(document.documentElement.dataset.colorScheme).toBe('light'))
    expect(history.getAttribute('aria-current')).toBe('page')
  })
})

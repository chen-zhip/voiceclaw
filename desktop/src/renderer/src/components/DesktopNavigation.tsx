import { useEffect, useRef, useState, type RefObject } from 'react'
import { Clock, Menu, MessageCircle, Settings, SquarePen, X } from 'lucide-react'
import { VoiceClawMark } from './brand/VoiceClawMark'

export type DesktopDestination = 'chat' | 'history' | 'settings'

interface DesktopNavigationProps {
  activeDestination: DesktopDestination
  onDestinationChange: (destination: DesktopDestination) => void
  onNewChat: () => void
}

const NARROW_SHELL_QUERY = '(max-width: 760px)'

const destinations: { id: DesktopDestination; label: string; icon: typeof MessageCircle }[] = [
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'history', label: 'History', icon: Clock },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export function DesktopNavigation({
  activeDestination,
  onDestinationChange,
  onNewChat,
}: DesktopNavigationProps) {
  const isNarrow = useMediaQuery(NARROW_SHELL_QUERY)
  const [mobileOpen, setMobileOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const railRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!isNarrow) setMobileOpen(false)
  }, [isNarrow])

  useEffect(() => {
    if (!mobileOpen) return
    const rail = railRef.current
    const workspace = document.querySelector('main')
    const workspaceWasInert = workspace?.hasAttribute('inert') ?? false
    workspace?.setAttribute('inert', '')
    rail?.querySelector<HTMLButtonElement>('nav button')?.focus()

    const handleDialogKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false)
        menuButtonRef.current?.focus()
        return
      }
      if (event.key !== 'Tab' || !rail) return
      const focusable = Array.from(
        rail.querySelectorAll<HTMLElement>('button:not([disabled]), [href]')
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (
        event.shiftKey &&
        (document.activeElement === first || !rail.contains(document.activeElement))
      ) {
        event.preventDefault()
        last.focus()
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !rail.contains(document.activeElement))
      ) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleDialogKey)
    return () => {
      window.removeEventListener('keydown', handleDialogKey)
      if (!workspaceWasInert) workspace?.removeAttribute('inert')
    }
  }, [mobileOpen])

  const navigate = (tab: DesktopDestination) => {
    onDestinationChange(tab)
    if (isNarrow) {
      setMobileOpen(false)
      requestAnimationFrame(() => menuButtonRef.current?.focus())
    }
  }

  const startNewChat = () => {
    onNewChat()
    if (isNarrow) {
      setMobileOpen(false)
      requestAnimationFrame(() => menuButtonRef.current?.focus())
    }
  }

  if (!isNarrow) {
    return (
      <NavigationRail
        activeDestination={activeDestination}
        onNavigate={navigate}
        onNewChat={startNewChat}
      />
    )
  }

  const menuPosition = window.electronAPI?.platform === 'darwin' ? 'left-20' : 'left-3'

  return (
    <div className="w-0 shrink-0">
      {!mobileOpen && (
        <button
          ref={menuButtonRef}
          type="button"
          aria-label="Open navigation"
          onClick={() => setMobileOpen(true)}
          className={`no-drag fixed top-3 z-40 flex size-9 items-center justify-center rounded-lg bg-[var(--shell-raised)] text-[var(--shell-text)] shadow-lg focus-visible:ring-2 focus-visible:ring-[var(--shell-signal)] focus-visible:outline-none ${menuPosition}`}>
          <Menu size={19} />
        </button>
      )}
      {mobileOpen && (
        <>
          <button
            type="button"
            aria-label="Close navigation overlay"
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-black/45"
          />
          <NavigationRail
            ref={railRef}
            activeDestination={activeDestination}
            onNavigate={navigate}
            onNewChat={startNewChat}
            mobile
            onClose={() => {
              setMobileOpen(false)
              menuButtonRef.current?.focus()
            }}
          />
        </>
      )}
    </div>
  )
}

function NavigationRail({
  ref,
  activeDestination,
  onNavigate,
  onNewChat,
  mobile = false,
  onClose,
}: {
  ref?: RefObject<HTMLElement | null>
  activeDestination: DesktopDestination
  onNavigate: (tab: DesktopDestination) => void
  onNewChat: () => void
  mobile?: boolean
  onClose?: () => void
}) {
  return (
    <aside
      ref={ref}
      role={mobile ? 'dialog' : undefined}
      aria-modal={mobile ? 'true' : undefined}
      aria-label={mobile ? 'Navigation menu' : undefined}
      className={`flex h-full w-[260px] shrink-0 flex-col border-r border-[var(--shell-border)] bg-[var(--shell-navigation)] px-3 pb-3 text-[var(--shell-text)] ${mobile ? 'fixed inset-y-0 left-0 z-50 shadow-2xl' : ''}`}>
      <div className="drag-region h-8 shrink-0" />
      <div className="no-drag flex items-center gap-2 px-2 py-3">
        <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--shell-raised)] shadow-sm">
          <VoiceClawMark className="size-5" accent />
        </span>
        <span className="vc-font-serif flex-1 text-[15px] font-semibold tracking-tight">
          VoiceClaw
        </span>
        {mobile && (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--shell-muted)] hover:bg-[var(--shell-selected)] hover:text-[var(--shell-text)] focus-visible:ring-2 focus-visible:ring-[var(--shell-signal)] focus-visible:outline-none">
            <X size={18} />
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onNewChat}
        className="no-drag mt-2 flex items-center gap-3 rounded-lg bg-[var(--shell-raised)] px-3 py-2.5 text-left text-sm font-medium text-[var(--shell-text)] shadow-sm transition-colors hover:bg-[var(--shell-selected)] focus-visible:ring-2 focus-visible:ring-[var(--shell-signal)] focus-visible:outline-none">
        <SquarePen size={17} strokeWidth={1.8} />
        <span>New chat</span>
      </button>

      <nav aria-label="Primary navigation" className="no-drag mt-2 flex flex-col gap-1">
        {destinations.map((tab) => {
          const Icon = tab.icon
          const isActive = activeDestination === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onNavigate(tab.id)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-[var(--shell-signal)] focus-visible:outline-none ${
                isActive
                  ? 'bg-[var(--shell-selected)] font-medium text-[var(--shell-text)]'
                  : 'text-[var(--shell-muted)] hover:bg-[var(--shell-selected)]/60 hover:text-[var(--shell-text)]'
              }`}>
              <Icon size={17} strokeWidth={1.8} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="drag-region min-h-8 flex-1" />
      <div className="no-drag border-t border-[var(--shell-border)] px-3 pt-3 text-[11px] text-[var(--shell-muted)]">
        Voice workspace
      </div>
    </aside>
  )
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false)

  useEffect(() => {
    const media = window.matchMedia?.(query)
    if (!media) return
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])

  return matches
}

import { useCallback, useEffect, useState } from 'react'
import { DesktopNavigation, type DesktopDestination } from './components/DesktopNavigation'
import { UpdateBanner } from './components/UpdateBanner'
import { ChatPage } from './pages/ChatPage'
import { HistoryPage } from './pages/HistoryPage'
import { SettingsPage } from './pages/SettingsPage'
import { ConversationProvider } from './lib/conversation-context'
import { useTheme } from './lib/use-theme'
import { OnboardingWizard, type WizardStepId } from './pages/onboarding/OnboardingWizard'
import { onboarding, type OnboardingState } from './lib/onboarding-api'

const ONBOARDING_STEP_IDS: WizardStepId[] = [
  'welcome',
  'signin',
  'permissions',
  'provider',
  'brain',
  'testcall',
]

export function App() {
  const [activeDestination, setActiveDestination] = useState<DesktopDestination>('chat')
  const [newConversationRequestId, setNewConversationRequestId] = useState(0)
  const [bootState, setBootState] = useState<OnboardingState | null>(null)
  const [showWizard, setShowWizard] = useState(false)
  const [bootChecked, setBootChecked] = useState(false)

  const onboardingFlag = parseOnboardingFlag()
  const interfacePreview = parseInterfacePreview()

  // Initialize theme system (applies dark/light class to html)
  useTheme()

  const navigateToChat = useCallback(() => setActiveDestination('chat'), [])
  const startNewChat = useCallback(() => {
    setActiveDestination('chat')
    setNewConversationRequestId((requestId) => requestId + 1)
  }, [])

  // First-mount: ask main whether onboarding is complete. The wizard
  // shows iff completedAt is null. The ?onboarding=1 URL flag (used by
  // Storybook-style design previews) forces the wizard regardless.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const state = await onboarding.getState()
        if (cancelled) return
        setBootState(state)
        setShowWizard(state.completedAt === null)
      } catch (err) {
        // If the bridge isn't available yet (e.g. preview mode in a
        // browser tab) fall back to showing the main app.
        console.warn('[onboarding] getState failed', err)
      } finally {
        if (!cancelled) setBootChecked(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return

      switch (e.key) {
        case ',':
          e.preventDefault()
          setActiveDestination('settings')
          break
        case '1':
          e.preventDefault()
          setActiveDestination('chat')
          break
        case '2':
          e.preventDefault()
          setActiveDestination('history')
          break
        case '3':
          e.preventDefault()
          setActiveDestination('settings')
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Design-preview override: ?onboarding=1[&step=…] always shows the
  // wizard at the requested step with empty payload. Used by the docs
  // site previews where there is no main process to talk to.
  if (onboardingFlag?.enabled) {
    return (
      <OnboardingWizard
        initialState={{
          currentStep: onboardingFlag.step,
          payload: {},
          completedAt: null,
        }}
        previewMode
      />
    )
  }

  // Hold the splash blank for a single tick while we decide. Avoids
  // briefly flashing the main app then swapping to the wizard.
  if (!bootChecked) {
    return <div className="bg-background h-screen w-screen" />
  }

  if (showWizard) {
    return (
      <OnboardingWizard
        initialState={bootState ?? { currentStep: 'welcome', payload: {}, completedAt: null }}
        onComplete={() => setShowWizard(false)}
      />
    )
  }

  return (
    <ConversationProvider>
      <div className="text-foreground flex h-screen flex-col bg-[var(--shell-workspace)]">
        <UpdateBanner preview={interfacePreview === 'update'} />
        <div className="flex min-h-0 flex-1">
          <DesktopNavigation
            activeDestination={activeDestination}
            onDestinationChange={setActiveDestination}
            onNewChat={startNewChat}
          />
          <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--shell-workspace)]">
            <section
              role="region"
              aria-label="Chat view"
              hidden={activeDestination !== 'chat'}
              className="min-h-0 flex-1 flex-col overflow-hidden data-[visible=true]:flex"
              data-visible={activeDestination === 'chat'}>
              <ChatPage
                isActive={activeDestination === 'chat'}
                newConversationRequestId={newConversationRequestId}
                previewVoiceState={
                  interfacePreview === 'connecting' || interfacePreview === 'active'
                    ? interfacePreview
                    : undefined
                }
                onNavigateToSettings={() => setActiveDestination('settings')}
              />
            </section>
            <section
              role="region"
              aria-label="History view"
              hidden={activeDestination !== 'history'}
              className="min-h-0 flex-1 flex-col overflow-hidden data-[visible=true]:flex"
              data-visible={activeDestination === 'history'}>
              <HistoryPage
                isVisible={activeDestination === 'history'}
                onNavigateToChat={navigateToChat}
              />
            </section>
            <section
              role="region"
              aria-label="Settings view"
              hidden={activeDestination !== 'settings'}
              className="min-h-0 flex-1 flex-col overflow-hidden data-[visible=true]:flex"
              data-visible={activeDestination === 'settings'}>
              <SettingsPage />
            </section>
          </main>
        </div>
      </div>
    </ConversationProvider>
  )
}

function parseInterfacePreview() {
  if (!import.meta.env.DEV) return null
  const preview = new URLSearchParams(window.location.search).get('interface-preview')
  return preview === 'connecting' || preview === 'active' || preview === 'update' ? preview : null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseOnboardingFlag(): { enabled: boolean; step: WizardStepId } | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  if (params.get('onboarding') !== '1') return null
  const stepParam = params.get('step') ?? 'welcome'
  const step = (ONBOARDING_STEP_IDS as string[]).includes(stepParam)
    ? (stepParam as WizardStepId)
    : 'welcome'
  return { enabled: true, step }
}

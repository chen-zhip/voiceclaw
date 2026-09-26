import { vi } from 'vitest'
import type {
  Attachment,
  AttachmentInput,
  Conversation,
  ConversationWithPreview,
  Message,
  PickImageResult,
} from '../lib/db'

interface RendererTestBoundaryOptions {
  conversation?: Conversation | null
  conversationPreviews?: ConversationWithPreview[]
  messages?: Message[]
  attachments?: Attachment[]
  attachmentPickResult?: PickImageResult
  settings?: Record<string, string>
  viewport?: {
    width?: number
    colorScheme?: 'light' | 'dark'
    reducedMotion?: boolean
  }
}

export function installRendererTestBoundaries(options: RendererTestBoundaryOptions = {}) {
  const clipboardWriteText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
  const settings = options.settings ?? {}
  const conversation = options.conversation ?? null
  const conversationPreviews = options.conversationPreviews ?? []
  const messages = [...(options.messages ?? [])]
  const attachments = options.attachments ?? []
  const attachmentPickImage = vi.fn<() => Promise<PickImageResult>>().mockResolvedValue(
    options.attachmentPickResult ?? {
      ok: false,
      cancelled: true,
    }
  )
  const webSockets: RendererTestWebSocket[] = []
  const viewport = installViewportBoundary(options.viewport)

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWriteText },
  })

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockRejectedValue(new Error('media unavailable in renderer test')),
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
  })

  class RendererTestWebSocket {
    static OPEN = 1
    readyState = 0
    onopen: (() => void) | null = null
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: (() => void) | null = null
    onclose: (() => void) | null = null
    close = vi.fn()
    send = vi.fn()

    constructor() {
      webSockets.push(this)
    }

    emit(data: Record<string, unknown>) {
      this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
    }

    disconnect() {
      this.onclose?.()
    }
  }

  vi.stubGlobal('WebSocket', RendererTestWebSocket)

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      platform: 'win32',
      db: {
        createConversation: vi.fn().mockResolvedValue({
          id: 999,
          title: 'New conversation',
          created_at: 1,
          updated_at: 1,
        }),
        getLatestConversation: vi.fn().mockResolvedValue(conversation),
        getConversations: vi.fn().mockResolvedValue(conversation ? [conversation] : []),
        getConversationsWithPreview: vi.fn().mockResolvedValue(conversationPreviews),
        getConversation: vi.fn().mockResolvedValue(conversation),
        deleteConversation: vi.fn().mockResolvedValue(undefined),
        updateConversationTitle: vi.fn().mockResolvedValue(undefined),
        deleteAllConversations: vi.fn().mockResolvedValue(undefined),
        addMessage: vi.fn((conversationId: number, role: Message['role'], content: string) => {
          const message: Message = {
            id: Math.max(0, ...messages.map((item) => item.id)) + 1,
            conversation_id: conversationId,
            role,
            content,
            created_at: Date.now(),
            stt_latency_ms: null,
            llm_latency_ms: null,
            tts_latency_ms: null,
            stt_provider: null,
            llm_provider: null,
            tts_provider: null,
          }
          messages.push(message)
          return Promise.resolve(message)
        }),
        getMessages: vi.fn().mockResolvedValue(messages),
        deleteMessage: vi.fn().mockResolvedValue({ ok: true }),
        attachToMessage: vi.fn((messageId: number, input: AttachmentInput) =>
          Promise.resolve({
            ok: true,
            attachment: {
              id: attachments.length + 1,
              message_id: messageId,
              kind: input.kind,
              mime: input.mime,
              storage: 'inline',
              data: input.base64,
              path: null,
              width: input.width ?? null,
              height: input.height ?? null,
              byte_size: input.byteSize,
              original_name: input.originalName ?? null,
              created_at: Date.now(),
            },
          })
        ),
        getAttachmentsForMessage: vi.fn().mockResolvedValue([]),
        getAttachmentsForConversation: vi.fn().mockResolvedValue(attachments),
        getSetting: vi.fn((key: string) => Promise.resolve(settings[key] ?? null)),
        setSetting: vi.fn().mockResolvedValue(undefined),
        getAllSettings: vi.fn().mockResolvedValue(settings),
      },
      logs: { reveal: vi.fn().mockResolvedValue({ ok: true, path: '' }) },
      net: { healthCheck: vi.fn().mockResolvedValue({ ok: true }) },
      updates: {
        getState: vi.fn().mockResolvedValue({ status: 'idle' }),
        checkNow: vi.fn().mockResolvedValue({ status: 'idle' }),
        installNow: vi.fn().mockResolvedValue(undefined),
        onStateChanged: vi.fn(() => () => {}),
        onStaged: vi.fn(() => () => {}),
      },
      onboarding: {
        getState: vi.fn().mockResolvedValue({
          currentStep: 'welcome',
          payload: {},
          completedAt: '2026-09-22T00:00:00.000Z',
        }),
        updateStep: vi.fn(),
        complete: vi.fn(),
        reset: vi.fn().mockResolvedValue({ ok: false }),
        startSignIn: vi.fn().mockResolvedValue({ ok: true }),
        onAuthCallback: vi.fn(() => () => {}),
      },
      provider: {
        listConfigured: vi.fn().mockResolvedValue([]),
        validateAndSave: vi.fn().mockResolvedValue({ ok: true }),
        geminiSmoke: vi.fn().mockResolvedValue({ ok: true, text: 'ok' }),
      },
      identity: {
        get: vi.fn().mockResolvedValue({ name: 'VoiceClaw', description: '', voice: 'Zephyr' }),
        save: vi.fn(),
        speakPreview: vi.fn().mockResolvedValue({ ok: false, error: 'unavailable in test' }),
        getVoicePreview: vi.fn().mockResolvedValue({ ok: false, error: 'unavailable in test' }),
      },
      permissions: {
        getMediaStatus: vi.fn().mockResolvedValue('granted'),
        requestMic: vi.fn().mockResolvedValue(true),
        openSettings: vi.fn().mockResolvedValue(undefined),
      },
      brain: { detect: vi.fn().mockResolvedValue({}) },
      shortcuts: {
        list: vi.fn().mockResolvedValue([]),
        set: vi.fn().mockResolvedValue({ ok: true }),
        clear: vi.fn().mockResolvedValue(undefined),
        resetDefaults: vi.fn().mockResolvedValue([]),
        onTriggered: vi.fn(() => () => {}),
      },
      telemetry: {
        getDistinctId: vi.fn().mockResolvedValue('renderer-test'),
        getOptedOut: vi.fn().mockResolvedValue(false),
        setOptedOut: vi.fn().mockResolvedValue(false),
        capture: vi.fn().mockResolvedValue(undefined),
        captureException: vi.fn().mockResolvedValue(undefined),
      },
      attachments: { pickImage: attachmentPickImage },
      callBar: {
        sendMuted: vi.fn(),
        onMuteToggleRequest: vi.fn(() => () => {}),
        onEndCallRequest: vi.fn(() => () => {}),
      },
      drawOverlay: {
        show: vi.fn().mockResolvedValue(undefined),
        hide: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
        setMode: vi.fn().mockResolvedValue(undefined),
        onStrokes: vi.fn(() => () => {}),
        onDisplayBounds: vi.fn(() => () => {}),
        onModeChanged: vi.fn(() => () => {}),
      },
      screen: { getWindowBounds: vi.fn().mockResolvedValue(null) },
      app: { getServicePorts: vi.fn().mockResolvedValue({ relay: 3001 }) },
    },
  })

  Element.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.scrollTo = vi.fn()

  return { attachmentPickImage, clipboardWriteText, messages, settings, viewport, webSockets }
}

function installViewportBoundary(initial: RendererTestBoundaryOptions['viewport'] = {}) {
  const state = {
    width: initial?.width ?? 1280,
    colorScheme: initial?.colorScheme ?? ('light' as const),
    reducedMotion: initial?.reducedMotion ?? false,
  }
  const queries = new Set<TestMediaQueryList>()

  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    get: () => state.width,
  })

  window.matchMedia = vi.fn((query: string) => {
    const result = new TestMediaQueryList(query, () => matchesQuery(query, state))
    queries.add(result)
    return result
  })

  const notify = () => {
    window.dispatchEvent(new Event('resize'))
    queries.forEach((query) => query.notify())
  }

  return {
    resize(width: number) {
      state.width = width
      notify()
    },
    setColorScheme(colorScheme: 'light' | 'dark') {
      state.colorScheme = colorScheme
      notify()
    },
    setReducedMotion(reducedMotion: boolean) {
      state.reducedMotion = reducedMotion
      notify()
    },
  }
}

class TestMediaQueryList implements MediaQueryList {
  private listeners = new Set<(event: MediaQueryListEvent) => void>()
  private previous: boolean

  constructor(
    readonly media: string,
    private readonly evaluate: () => boolean
  ) {
    this.previous = evaluate()
  }

  get matches() {
    return this.evaluate()
  }

  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null = null

  addEventListener(_type: 'change', listener: (event: MediaQueryListEvent) => void) {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'change', listener: (event: MediaQueryListEvent) => void) {
    this.listeners.delete(listener)
  }

  addListener(listener: (event: MediaQueryListEvent) => void) {
    this.listeners.add(listener)
  }

  removeListener(listener: (event: MediaQueryListEvent) => void) {
    this.listeners.delete(listener)
  }

  dispatchEvent(event: Event) {
    this.listeners.forEach((listener) => listener(event as MediaQueryListEvent))
    return true
  }

  notify() {
    const next = this.matches
    if (next === this.previous) return
    this.previous = next
    const event = new Event('change') as MediaQueryListEvent
    Object.defineProperty(event, 'matches', { value: next })
    Object.defineProperty(event, 'media', { value: this.media })
    this.onchange?.call(this, event)
    this.dispatchEvent(event)
  }
}

function matchesQuery(
  query: string,
  state: { width: number; colorScheme: 'light' | 'dark'; reducedMotion: boolean }
) {
  const maxWidth = query.match(/max-width:\s*(\d+)px/)
  if (maxWidth && state.width > Number(maxWidth[1])) return false
  const minWidth = query.match(/min-width:\s*(\d+)px/)
  if (minWidth && state.width < Number(minWidth[1])) return false
  if (query.includes('prefers-color-scheme: dark') && state.colorScheme !== 'dark') return false
  if (query.includes('prefers-color-scheme: light') && state.colorScheme !== 'light') return false
  if (query.includes('prefers-reduced-motion: reduce') && !state.reducedMotion) return false
  return true
}

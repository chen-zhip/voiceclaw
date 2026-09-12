import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { UpdateState } from '../lib/db'
import { Eye, EyeOff, Play } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Toggle } from '../components/ui/Toggle'
import { DevicesCard } from '../components/DevicesCard'
import { ShortcutsCard } from '../components/ShortcutsCard'
import { identityApi, onboarding, providerApi, type ProviderId } from '../lib/onboarding-api'
import { decodeVoicePreviewAudio } from '../lib/voice-preview'
import { useTheme, type Theme } from '../lib/use-theme'
import { enumerateAudioDevices, type AudioDevice } from '../lib/audio-engine'
import { getSetting, setSetting } from '../lib/db'
import {
  GEMINI_VOICES,
  OPENAI_VOICES,
  XAI_VOICES,
  getVoiceForProvider,
  isVoiceForProvider,
  providerForModel,
  setVoiceForProvider,
} from '../lib/voice-prefs'
import { captureRenderer, isOptedOutRenderer, setOptedOutRenderer } from '../lib/telemetry'

const GEMINI_VOICE_LABELS: Record<(typeof GEMINI_VOICES)[number], string> = {
  Puck: 'Puck (M)',
  Charon: 'Charon (M)',
  Kore: 'Kore (F)',
  Fenrir: 'Fenrir (M)',
  Aoede: 'Aoede (F)',
  Leda: 'Leda (F)',
  Orus: 'Orus (M)',
  Zephyr: 'Zephyr (F)',
}

const XAI_VOICE_LABELS: Record<(typeof XAI_VOICES)[number], string> = {
  eve: 'Eve (F)',
  ara: 'Ara (F)',
  rex: 'Rex (M)',
  sal: 'Sal (N)',
  leo: 'Leo (M)',
}

const OPENAI_VOICE_LABELS: Record<(typeof OPENAI_VOICES)[number], string> = {
  marin: 'Marin (F)',
  cedar: 'Cedar (M)',
  alloy: 'Alloy (N)',
  ash: 'Ash (M)',
  ballad: 'Ballad (M)',
  coral: 'Coral (F)',
  echo: 'Echo (M)',
  sage: 'Sage (N)',
  shimmer: 'Shimmer (F)',
  verse: 'Verse (M)',
}

type RealtimeModel =
  | 'gemini-3.1-flash-live-preview'
  | 'grok-voice-think-fast-1.0'
  | 'gpt-realtime-2'
  | 'gpt-realtime-mini'
const DEFAULT_REALTIME_MODEL: RealtimeModel = 'gemini-3.1-flash-live-preview'

// Mirror of the relay-server VoiceMode / AgentBackend enums. Persisted in
// the desktop settings KV; the literal strings cross the wire as
// session.config.voiceMode / session.config.agentBackend.
type VoiceMode = 'direct' | 'operator' | 'supervisor' | 'stt-tts-harness'
const VOICE_MODES: readonly VoiceMode[] = ['direct', 'operator', 'supervisor', 'stt-tts-harness']
const DEFAULT_VOICE_MODE: VoiceMode = 'direct'

type AgentBackend = 'pi' | 'openai' | 'hermes'
const AGENT_BACKENDS: readonly AgentBackend[] = ['pi', 'openai', 'hermes']
const DEFAULT_AGENT_BACKEND: AgentBackend = 'pi'

function normalizeVoiceMode(value: string | null): VoiceMode {
  return VOICE_MODES.includes(value as VoiceMode) ? (value as VoiceMode) : DEFAULT_VOICE_MODE
}

function normalizeAgentBackend(value: string | null): AgentBackend {
  return AGENT_BACKENDS.includes(value as AgentBackend)
    ? (value as AgentBackend)
    : DEFAULT_AGENT_BACKEND
}

const REALTIME_MODEL_LABELS: Record<RealtimeModel, string> = {
  'gemini-3.1-flash-live-preview': 'Gemini 3.1 Flash Live',
  'grok-voice-think-fast-1.0': 'Grok Voice Think Fast 1.0',
  'gpt-realtime-2': 'GPT Realtime 2',
  'gpt-realtime-mini': 'GPT Realtime Mini',
}

const REALTIME_MODELS: readonly RealtimeModel[] = [
  'gemini-3.1-flash-live-preview',
  'grok-voice-think-fast-1.0',
  'gpt-realtime-2',
  'gpt-realtime-mini',
]

const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  xai: 'xAI',
}

const PROVIDER_DISPLAY_LABELS: Record<ProviderId, string> = {
  gemini: 'Google',
  openai: 'OpenAI',
  xai: 'xAI',
}

const PROVIDER_KEY_META: Record<
  ProviderId,
  { url: string; linkLabel: string; placeholder: string }
> = {
  gemini: {
    url: 'https://aistudio.google.com/apikey',
    linkLabel: 'aistudio.google.com',
    placeholder: 'AIza...',
  },
  openai: {
    url: 'https://platform.openai.com/api-keys',
    linkLabel: 'platform.openai.com',
    placeholder: 'sk-...',
  },
  xai: {
    url: 'https://console.x.ai',
    linkLabel: 'console.x.ai',
    placeholder: 'xai-...',
  },
}

export function SettingsPage() {
  const { theme, setTheme } = useTheme()

  // Web Search (Tavily) — when enabled AND a key is set, the realtime model
  // gets a fast web_search tool alongside ask_brain. Stored as plain settings
  // KV like the relay api key. The enabled flag is independent of the key so
  // the user can pause web_search without losing their saved key.
  const [tavilyKey, setTavilyKey] = useState('')
  const [tavilyEnabled, setTavilyEnabled] = useState(true)
  const [showTavilyKey, setShowTavilyKey] = useState(false)

  // Model + Voice
  const [model, setModel] = useState<RealtimeModel>('gemini-3.1-flash-live-preview')
  const [voice, setVoice] = useState<string>('Zephyr')

  // Voice Mode + Agent backend. See VoiceMode / AgentBackend above for the
  // wire contract. Both are persisted to SQLite settings and forwarded to
  // the relay in every session.config.
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(DEFAULT_VOICE_MODE)
  const [agentBackend, setAgentBackend] = useState<AgentBackend>(DEFAULT_AGENT_BACKEND)
  // Explicit STT/TTS Harness selection. The binding belongs to the Relay; the
  // Provider and Workspace must match its Active Host Assignment.
  const [harnessProviderId, setHarnessProviderId] = useState('')
  const [harnessWorkspaceBindingId, setHarnessWorkspaceBindingId] = useState('')
  const [harnessBindingId, setHarnessBindingId] = useState('')

  // Per-provider realtime API keys (Keychain-backed via main process).
  // We never read the secret back into the UI — only the list of which
  // providers currently have a key set, so we can render a "configured"
  // indicator and let the user overwrite.
  const [configuredProviders, setConfiguredProviders] = useState<ProviderId[]>([])

  // Audio
  const [volume, setVolume] = useState(1.0)
  const [inputDeviceId, setInputDeviceId] = useState('')
  const [outputDeviceId, setOutputDeviceId] = useState('')
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([])

  // Call bar (floating window during sessions)
  const [callBarEnabled, setCallBarEnabled] = useState(true)

  // Debug
  const [debugMode, setDebugMode] = useState(false)
  const [showLatency, setShowLatency] = useState(false)
  const [showContextUsage, setShowContextUsage] = useState(false)
  const [tracingEnabled, setTracingEnabled] = useState(false)
  const [exportingBundle, setExportingBundle] = useState(false)
  const [bundleToast, setBundleToast] = useState<{ ok: boolean; message: string } | null>(null)
  const [doctorRunning, setDoctorRunning] = useState(false)
  const [doctorResult, setDoctorResult] = useState<DoctorResultShape | null>(null)
  const [doctorCopied, setDoctorCopied] = useState(false)

  // Agent identity (name + description)
  const [agentName, setAgentName] = useState('')
  const [agentDescription, setAgentDescription] = useState('')
  const identityLoadedRef = useRef(false)

  // Voice preview playback (clicking ▶ on a voice card plays a sample
  // without changing the selection). Errors render inline below the grid.
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState('')
  const previewClipRef = useRef<{ audio: HTMLAudioElement; revoke: () => void } | null>(null)
  // Monotonic token used to invalidate stale in-flight preview requests
  // when the user clicks another voice (or unmounts) before the IPC returns.
  const previewTokenRef = useRef(0)

  // Privacy / telemetry
  const [telemetryEnabled, setTelemetryEnabled] = useState(true)

  // Updates
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  const loadedRef = useRef(false)

  // Load all settings on mount
  useEffect(() => {
    ;(async () => {
      const tk = await getSetting('tavily_api_key')
      if (tk) setTavilyKey(tk)
      // Default to enabled. Only treat the explicit string 'false' as off so
      // a missing setting (first-run) starts in the on state.
      const te = await getSetting('tavily_enabled')
      setTavilyEnabled(te !== 'false')
      const m = await getSetting('realtime_model')
      const loadedModel = normalizeRealtimeModel(m)
      setModel(loadedModel)
      if (m && m !== loadedModel) setSetting('realtime_model', loadedModel)
      const loadedVoice = await getVoiceForProvider(providerForModel(loadedModel))
      setVoice(loadedVoice)
      const vm = await getSetting('voice_mode')
      setVoiceMode(normalizeVoiceMode(vm))
      const ab = await getSetting('agent_backend')
      setAgentBackend(normalizeAgentBackend(ab))
      setHarnessProviderId((await getSetting('harness_provider_id')) ?? '')
      setHarnessWorkspaceBindingId((await getSetting('harness_workspace_binding_id')) ?? '')
      setHarnessBindingId((await getSetting('harness_binding_id')) ?? '')
      const vol = await getSetting('realtime_volume')
      if (vol) setVolume(parseFloat(vol))
      const inDev = await getSetting('input_device_id')
      if (inDev) setInputDeviceId(inDev)
      const outDev = await getSetting('output_device_id')
      if (outDev) setOutputDeviceId(outDev)
      const cb = await getSetting('call_bar_enabled')
      // Default ON — only explicit 'false' disables. Missing row = on.
      setCallBarEnabled(cb !== 'false')
      const dm = await getSetting('debug_mode')
      if (dm === 'true') setDebugMode(true)
      const sl = await getSetting('show_latency')
      if (sl === 'true') setShowLatency(true)
      const scu = await getSetting('show_context_usage')
      if (scu === 'true') setShowContextUsage(true)
      const tr = await getSetting('tracing_enabled')
      if (tr === 'true') setTracingEnabled(true)

      try {
        const id = await identityApi.get()
        setAgentName(id.name)
        setAgentDescription(id.description)
      } catch {
        // identity bridge unavailable — leave defaults
      }
      identityLoadedRef.current = true

      const optedOut = await isOptedOutRenderer()
      setTelemetryEnabled(!optedOut)

      try {
        const configured = await providerApi.listConfigured()
        setConfiguredProviders(configured)
      } catch (err) {
        console.warn('[settings] provider listConfigured failed', err)
      }

      loadedRef.current = true
    })()

    enumerateAudioDevices().then(setAudioDevices).catch(console.error)
  }, [])

  const refreshConfiguredProviders = useCallback(async () => {
    try {
      const configured = await providerApi.listConfigured()
      setConfiguredProviders(configured)
    } catch (err) {
      console.warn('[settings] provider listConfigured failed', err)
    }
  }, [])

  useEffect(() => {
    const api = window.electronAPI?.updates
    if (!api) return
    api
      .getState()
      .then(setUpdateState)
      .catch(() => {})
    const remove = api.onStateChanged(setUpdateState)
    return remove
  }, [])

  // Save setting to DB immediately
  const save = useCallback((key: string, value: string) => {
    setSetting(key, value)
  }, [])

  const updateTavilyKey = useCallback(
    (v: string) => {
      setTavilyKey(v)
      if (loadedRef.current) {
        save('tavily_api_key', v)
        if (v && !tavilyKey) {
          captureRenderer('provider_key_saved', { provider: 'tavily' })
        }
      }
    },
    [save, tavilyKey]
  )

  const toggleTavilyEnabled = useCallback((v: boolean) => {
    setTavilyEnabled(v)
    setSetting('tavily_enabled', v ? 'true' : 'false')
  }, [])

  const updateModel = useCallback(
    (v: RealtimeModel) => {
      setModel(v)
      if (loadedRef.current) save('realtime_model', v)
      const nextProvider = providerForModel(v)
      if (isVoiceForProvider(nextProvider, voice)) return
      void (async () => {
        const restored = await getVoiceForProvider(nextProvider)
        setVoice(restored)
        if (loadedRef.current) await setVoiceForProvider(nextProvider, restored)
      })()
    },
    [save, voice]
  )

  const updateVoice = useCallback(
    (v: string) => {
      setVoice(v)
      if (loadedRef.current) {
        void setVoiceForProvider(providerForModel(model), v)
      }
    },
    [model]
  )

  const updateVoiceMode = useCallback(
    (v: VoiceMode) => {
      setVoiceMode(v)
      if (loadedRef.current) save('voice_mode', v)
    },
    [save]
  )

  const updateAgentBackend = useCallback(
    (v: AgentBackend) => {
      setAgentBackend(v)
      if (loadedRef.current) save('agent_backend', v)
    },
    [save]
  )

  const updateHarness = useCallback(
    (
      key: 'harness_provider_id' | 'harness_workspace_binding_id' | 'harness_binding_id',
      v: string
    ) => {
      if (key === 'harness_provider_id') setHarnessProviderId(v)
      else if (key === 'harness_workspace_binding_id') setHarnessWorkspaceBindingId(v)
      else setHarnessBindingId(v)
      if (loadedRef.current) save(key, v)
    },
    [save]
  )

  // Stop + release any in-flight preview clip on unmount.
  useEffect(() => {
    return () => {
      previewTokenRef.current += 1
      const clip = previewClipRef.current
      if (clip) {
        try {
          clip.audio.pause()
        } catch {
          // ignore
        }
        clip.revoke()
        previewClipRef.current = null
      }
    }
  }, [])

  const handleVoicePreview = useCallback(async (voiceId: string) => {
    const token = ++previewTokenRef.current
    // Stop + release the previous clip so re-clicking restarts cleanly and
    // we don't leak the blob: URL backing a PCM preview.
    const prev = previewClipRef.current
    if (prev) {
      try {
        prev.audio.pause()
      } catch {
        // ignore
      }
      prev.revoke()
      previewClipRef.current = null
    }
    setPreviewError('')
    setPreviewing(voiceId)
    try {
      const result = await identityApi.getVoicePreview({ voice: voiceId })
      if (token !== previewTokenRef.current) return
      if (!result.ok) {
        setPreviewError(result.error)
        setPreviewing(null)
        return
      }
      const clip = decodeVoicePreviewAudio(result.audioBase64, result.mimeType)
      previewClipRef.current = clip
      const finish = () => {
        if (previewClipRef.current === clip) {
          clip.revoke()
          previewClipRef.current = null
        }
        setPreviewing((p) => (p === voiceId ? null : p))
      }
      clip.audio.onended = finish
      clip.audio.onerror = () => {
        setPreviewError(`Audio playback failed (${result.mimeType}).`)
        finish()
      }
      try {
        await clip.audio.play()
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : 'Could not play audio.')
        finish()
      }
    } catch (err) {
      if (token !== previewTokenRef.current) return
      setPreviewError(err instanceof Error ? err.message : 'Preview failed.')
      setPreviewing(null)
    }
  }, [])

  const updateVolume = useCallback(
    (v: number) => {
      setVolume(v)
      if (loadedRef.current) save('realtime_volume', String(v))
    },
    [save]
  )

  const updateInputDevice = useCallback(
    (v: string) => {
      setInputDeviceId(v)
      if (loadedRef.current) save('input_device_id', v)
    },
    [save]
  )

  const updateOutputDevice = useCallback(
    (v: string) => {
      setOutputDeviceId(v)
      if (loadedRef.current) save('output_device_id', v)
    },
    [save]
  )

  const toggleCallBar = useCallback((v: boolean) => {
    setCallBarEnabled(v)
    setSetting('call_bar_enabled', v ? 'true' : 'false')
  }, [])

  const toggleDebugMode = useCallback((v: boolean) => {
    setDebugMode(v)
    setSetting('debug_mode', v ? 'true' : 'false')
  }, [])

  const toggleShowLatency = useCallback((v: boolean) => {
    setShowLatency(v)
    setSetting('show_latency', v ? 'true' : 'false')
  }, [])

  const toggleShowContextUsage = useCallback((v: boolean) => {
    setShowContextUsage(v)
    setSetting('show_context_usage', v ? 'true' : 'false')
  }, [])

  const toggleTracing = useCallback((v: boolean) => {
    setTracingEnabled(v)
    setSetting('tracing_enabled', v ? 'true' : 'false')
  }, [])

  const persistIdentity = useCallback(
    (next: { name?: string; description?: string }) => {
      if (!identityLoadedRef.current) return
      identityApi
        .save({
          name: next.name ?? agentName,
          description: next.description ?? agentDescription,
          voice,
        })
        .catch((err) => console.warn('[settings] identity save failed', err))
    },
    [agentName, agentDescription, voice]
  )

  const updateAgentName = useCallback(
    (v: string) => {
      setAgentName(v)
      persistIdentity({ name: v })
    },
    [persistIdentity]
  )

  const updateAgentDescription = useCallback(
    (v: string) => {
      setAgentDescription(v)
      persistIdentity({ description: v })
    },
    [persistIdentity]
  )

  const toggleTelemetry = useCallback(async (v: boolean) => {
    setTelemetryEnabled(v)
    await setOptedOutRenderer(!v)
  }, [])

  const exportBundle = useCallback(async () => {
    const SUPPRESS_KEY = 'diag_privacy_preview_suppressed'
    const suppressed = await getSetting(SUPPRESS_KEY)
    if (suppressed !== 'true') {
      const confirmed = await showPrivacyPreview()
      if (!confirmed.proceed) return
      if (confirmed.suppress) await setSetting(SUPPRESS_KEY, 'true')
    }

    setExportingBundle(true)
    setBundleToast(null)
    try {
      const result = await window.electronAPI?.diagnostics?.export?.()
      if (!result) {
        setBundleToast({ ok: false, message: 'Export not available.' })
        return
      }
      if (result.ok) {
        setBundleToast({ ok: true, message: 'Diagnostic bundle saved to Downloads.' })
      } else {
        setBundleToast({ ok: false, message: result.error })
      }
    } catch (err) {
      setBundleToast({ ok: false, message: err instanceof Error ? err.message : 'Export failed.' })
    } finally {
      setExportingBundle(false)
      setTimeout(() => setBundleToast(null), 6000)
    }
  }, [])

  const runBrainDoctor = useCallback(async () => {
    setDoctorRunning(true)
    setDoctorResult(null)
    setDoctorCopied(false)
    try {
      const result = await window.electronAPI?.brain?.runDoctor?.()
      if (result) setDoctorResult(result)
    } catch (err) {
      console.warn('[SettingsPage] brain doctor failed', err)
    } finally {
      setDoctorRunning(false)
    }
  }, [])

  const copyDoctorResults = useCallback(async () => {
    if (!doctorResult) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(doctorResult, null, 2))
      setDoctorCopied(true)
      setTimeout(() => setDoctorCopied(false), 2500)
    } catch {
      // clipboard unavailable — silently skip
    }
  }, [doctorResult])

  const inputDevices = audioDevices.filter((d) => d.kind === 'audioinput')
  const outputDevices = audioDevices.filter((d) => d.kind === 'audiooutput')

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* Devices */}
        <DevicesCard />

        {/* Identity */}
        <Card className="space-y-4 p-4">
          <h3 className="text-foreground text-sm font-semibold">Agent Identity</h3>
          <div className="space-y-1.5">
            <label className="text-muted-foreground text-xs">Name</label>
            <Input
              value={agentName}
              onChange={(e) => updateAgentName(e.target.value)}
              placeholder="Pam"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-muted-foreground text-xs">Description</label>
            <textarea
              value={agentDescription}
              onChange={(e) => updateAgentDescription(e.target.value)}
              placeholder="Friendly, calm, helps me stay on top of things."
              rows={2}
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring w-full resize-none rounded-md border px-3 py-2 text-sm leading-snug outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            />
            <p className="text-muted-foreground text-[11px]">
              Used in the agent's system prompt. Saved as IDENTITY.md in the bundled openclaw
              workspace.
            </p>
          </div>
        </Card>

        {/* Web Search */}
        <Card className="space-y-4 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-foreground text-sm font-semibold">Web Search</h3>
              <p className="text-muted-foreground mt-1 text-xs">
                When enabled, the assistant gets a fast{' '}
                <code className="bg-muted rounded px-1 py-0.5">web_search</code> tool (Tavily) for
                quick public-web lookups (typically 1-3s) — much faster than going through the
                brain. Get a key at <span className="text-foreground">tavily.com</span>.
              </p>
            </div>
            <Toggle checked={tavilyEnabled} onChange={toggleTavilyEnabled} />
          </div>

          <div className={`space-y-1.5 ${tavilyEnabled ? '' : 'opacity-50'}`}>
            <label className="text-muted-foreground text-xs">Tavily API Key</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showTavilyKey ? 'text' : 'password'}
                  value={tavilyKey}
                  onChange={(e) => updateTavilyKey(e.target.value)}
                  placeholder="tvly-..."
                  className="pr-10"
                  disabled={!tavilyEnabled}
                />
                <button
                  onClick={() => setShowTavilyKey(!showTavilyKey)}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2">
                  {showTavilyKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <p className="text-muted-foreground text-[11px]">
              {!tavilyEnabled
                ? 'web_search disabled. Key is kept for when you re-enable.'
                : tavilyKey
                  ? 'web_search tool will be available next call.'
                  : 'Add a key to enable web_search; the assistant falls back to ask_brain otherwise.'}
            </p>
          </div>
        </Card>

        {/* Voice Model */}
        <VoiceModelCard
          model={model}
          configuredProviders={configuredProviders}
          onSelectModel={updateModel}
          onSaved={refreshConfiguredProviders}
        />

        {/* Voice Mode */}
        <VoiceModeCard mode={voiceMode} onSelect={updateVoiceMode} />

        {voiceMode === 'stt-tts-harness' && (
          <Card className="space-y-4 p-4">
            <div>
              <h3 className="text-foreground text-sm font-semibold">STT/TTS Harness binding</h3>
              <p className="text-muted-foreground mt-1 text-xs">
                These must match the Relay&apos;s Active Host Assignment. A call does not start
                until all three are set.
              </p>
            </div>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-muted-foreground text-xs">Provider ID</label>
                <Input
                  value={harnessProviderId}
                  onChange={(e) => updateHarness('harness_provider_id', e.target.value)}
                  placeholder="codex"
                />
              </div>
              <div className="space-y-1">
                <label className="text-muted-foreground text-xs">Workspace Binding ID</label>
                <Input
                  value={harnessWorkspaceBindingId}
                  onChange={(e) => updateHarness('harness_workspace_binding_id', e.target.value)}
                  placeholder="workspace-1"
                />
              </div>
              <div className="space-y-1">
                <label className="text-muted-foreground text-xs">Binding ID</label>
                <Input
                  value={harnessBindingId}
                  onChange={(e) => updateHarness('harness_binding_id', e.target.value)}
                  placeholder="binding-1"
                />
              </div>
            </div>
          </Card>
        )}

        {/* Agent */}
        <AgentBackendCard backend={agentBackend} onSelect={updateAgentBackend} />

        {/* Voice */}
        <Card className="space-y-4 p-4">
          <h3 className="text-foreground text-sm font-semibold">Voice</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {(providerForModel(model) === 'gemini'
              ? GEMINI_VOICES
              : providerForModel(model) === 'openai'
                ? OPENAI_VOICES
                : XAI_VOICES
            ).map((v) => {
              const provider = providerForModel(model)
              const label =
                provider === 'gemini'
                  ? GEMINI_VOICE_LABELS[v as (typeof GEMINI_VOICES)[number]]
                  : provider === 'openai'
                    ? OPENAI_VOICE_LABELS[v as (typeof OPENAI_VOICES)[number]]
                    : XAI_VOICE_LABELS[v as (typeof XAI_VOICES)[number]]
              const selected = voice === v
              const isPlaying = previewing === v
              return (
                <div
                  key={v}
                  className={`flex items-stretch gap-1 rounded-md border transition-colors ${selected ? 'border-primary bg-accent' : 'border-input'} `}>
                  <button
                    onClick={() => updateVoice(v)}
                    className={`flex-1 rounded-l-md px-3 py-2 text-left text-sm transition-colors ${selected ? 'text-foreground font-medium' : 'text-muted-foreground hover:bg-accent'} `}>
                    {label}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleVoicePreview(v)
                    }}
                    disabled={isPlaying}
                    aria-label={`Preview ${v} voice`}
                    title={isPlaying ? 'Playing…' : `Preview ${label}`}
                    className={`border-input text-muted-foreground hover:bg-background hover:text-foreground flex w-9 items-center justify-center rounded-r-md border-l transition-colors disabled:cursor-not-allowed disabled:opacity-50`}>
                    <Play size={14} className={isPlaying ? 'animate-pulse' : ''} />
                  </button>
                </div>
              )
            })}
          </div>
          {previewError ? (
            <p className="text-destructive text-xs" role="alert">
              {previewError}
            </p>
          ) : null}
        </Card>

        {/* Audio Devices */}
        <Card className="space-y-4 p-4">
          <h3 className="text-foreground text-sm font-semibold">Audio Devices</h3>

          <div className="space-y-1.5">
            <label className="text-muted-foreground text-xs">Input (Microphone)</label>
            <Select value={inputDeviceId} onChange={(e) => updateInputDevice(e.target.value)}>
              <option value="">System Default</option>
              {inputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-muted-foreground text-xs">Output (Speaker)</label>
            <Select value={outputDeviceId} onChange={(e) => updateOutputDevice(e.target.value)}>
              <option value="">System Default</option>
              {outputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-muted-foreground text-xs">
              Speaker Volume: {volume.toFixed(1)}x
            </label>
            <input
              type="range"
              min={0.5}
              max={3.0}
              step={0.1}
              value={volume}
              onChange={(e) => updateVolume(Math.round(parseFloat(e.target.value) * 10) / 10)}
              className="accent-primary w-full"
            />
            <div className="text-muted-foreground flex justify-between text-[10px]">
              <span>Quiet</span>
              <span>Max</span>
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => enumerateAudioDevices().then(setAudioDevices)}>
            Refresh Devices
          </Button>
        </Card>

        {/* Appearance */}
        <Card className="space-y-4 p-4">
          <h3 className="text-foreground text-sm font-semibold">Appearance</h3>
          <div className="flex gap-2">
            {(['dark', 'light', 'system'] as Theme[]).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`flex-1 rounded-md border px-3 py-2 text-sm capitalize transition-colors ${theme === t ? 'border-primary bg-accent text-foreground font-medium' : 'border-input text-muted-foreground hover:bg-accent'} `}>
                {t}
              </button>
            ))}
          </div>
        </Card>

        {/* Call Bar */}
        <Card className="space-y-4 p-4">
          <h3 className="text-foreground text-sm font-semibold">Call Bar</h3>

          <div className="flex items-center justify-between">
            <div className="pr-4">
              <p className="text-foreground text-sm">Show floating call bar during sessions</p>
              <p className="text-muted-foreground text-xs">
                A small always-on-top pill that shows live waveforms while you&apos;re on a call.
                Drag to reposition.
              </p>
            </div>
            <Toggle checked={callBarEnabled} onChange={toggleCallBar} />
          </div>
        </Card>

        <ShortcutsCard />

        {/* Updates */}
        <Card className="space-y-4 p-4">
          <h3 className="text-foreground text-sm font-semibold">Updates</h3>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground text-sm">Current version</p>
              <p className="text-muted-foreground text-xs">{updateState?.currentVersion ?? '—'}</p>
            </div>
            {updateState?.currentVersion && (
              <a
                href={`https://github.com/yagudaev/voiceclaw/releases/tag/desktop-v${updateState.currentVersion}`}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2">
                View release notes
              </a>
            )}
          </div>

          {updateState?.lastChecked && (
            <p className="text-muted-foreground text-xs">
              Last checked: {relativeTime(updateState.lastChecked)}
            </p>
          )}

          {updateState?.status === 'staged' && updateState.stagedVersion && (
            <div className="flex items-center justify-between rounded-md border border-[var(--brand-sage)] bg-[var(--brand-sage-wash)] px-3 py-2">
              <div>
                <p className="text-foreground text-sm font-medium">
                  Update ready: {updateState.stagedVersion}
                </p>
                <p className="text-muted-foreground text-xs">Restart to apply</p>
              </div>
              <Button
                variant="default"
                size="sm"
                onClick={async () => {
                  await window.electronAPI.updates.installNow('settings')
                }}>
                Restart now
              </Button>
            </div>
          )}

          {updateState?.status === 'error' && updateState.error && (
            <p className="text-destructive text-xs">{updateState.error}</p>
          )}

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={
                checkingUpdate ||
                updateState?.status === 'checking' ||
                updateState?.status === 'downloading'
              }
              onClick={async () => {
                setCheckingUpdate(true)
                try {
                  const next = await window.electronAPI.updates.checkNow()
                  setUpdateState(next)
                } finally {
                  setCheckingUpdate(false)
                }
              }}>
              {checkingUpdate || updateState?.status === 'checking'
                ? 'Checking…'
                : updateState?.status === 'downloading'
                  ? 'Downloading…'
                  : 'Check for updates'}
            </Button>
            {updateState?.status === 'up-to-date' && (
              <span className="text-muted-foreground text-xs">Up to date</span>
            )}
            {updateState?.status === 'downloading' && (
              <span className="text-muted-foreground text-xs">Downloading in background…</span>
            )}
          </div>
        </Card>

        {/* Debug */}
        <Card className="space-y-4 p-4">
          <h3 className="text-foreground text-sm font-semibold">Debug</h3>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground text-sm">Debug Mode</p>
              <p className="text-muted-foreground text-xs">Show event counters during calls</p>
            </div>
            <Toggle checked={debugMode} onChange={toggleDebugMode} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground text-sm">Show Latency</p>
              <p className="text-muted-foreground text-xs">
                Display latency badges on chat messages
              </p>
            </div>
            <Toggle checked={showLatency} onChange={toggleShowLatency} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground text-sm">Show Context Usage</p>
              <p className="text-muted-foreground text-xs">
                Live token count vs the model&apos;s context window during a call
              </p>
            </div>
            <Toggle checked={showContextUsage} onChange={toggleShowContextUsage} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground text-sm">Send Traces</p>
              <p className="text-muted-foreground text-xs">
                Post per-turn latency to Langfuse via relay
              </p>
            </div>
            <Toggle checked={tracingEnabled} onChange={toggleTracing} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground text-sm">Re-run onboarding wizard</p>
              <p className="text-muted-foreground text-xs">
                Resets the wizard cursor so you can step through it again. API keys and sign-in
                stay.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const result = await onboarding.reset()
                if (result.ok) window.location.reload()
              }}>
              Restart
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground text-sm">Reveal Logs in Finder</p>
              <p className="text-muted-foreground text-xs">
                Opens ~/Library/Logs/VoiceClaw/ in Finder. Useful when troubleshooting.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.electronAPI.logs.reveal()
              }}>
              Reveal
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground text-sm">Run brain diagnostic</p>
              <p className="text-muted-foreground text-xs">
                10-point check of the brain pipeline — openclaw, relay, Gemini API, and more.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={runBrainDoctor} disabled={doctorRunning}>
              {doctorRunning ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Running…
                </span>
              ) : (
                'Run'
              )}
            </Button>
          </div>

          {doctorResult && (
            <BrainDoctorPanel
              result={doctorResult}
              copied={doctorCopied}
              onCopy={copyDoctorResults}
            />
          )}

          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground text-sm">Export diagnostic bundle</p>
              <p className="text-muted-foreground text-xs">
                Bundles logs and config (with API keys redacted) for support. Saved to Downloads.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={exportBundle} disabled={exportingBundle}>
              {exportingBundle ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Bundling…
                </span>
              ) : (
                'Export'
              )}
            </Button>
          </div>

          {bundleToast && (
            <p
              className={`text-xs ${bundleToast.ok ? 'text-[var(--brand-sage)]' : 'text-destructive'}`}>
              {bundleToast.message}
            </p>
          )}
        </Card>

        {/* Privacy */}
        <Card className="space-y-4 p-4">
          <h3 className="text-foreground text-sm font-semibold">Privacy</h3>
          <div className="flex items-center justify-between">
            <div className="pr-4">
              <p className="text-foreground text-sm">Share anonymous diagnostics</p>
              <p className="text-muted-foreground text-xs">
                PostHog telemetry: usage events + crash reports. Never sends voice, transcripts, or
                API keys.
              </p>
            </div>
            <Toggle checked={telemetryEnabled} onChange={toggleTelemetry} />
          </div>
        </Card>
      </div>
    </div>
  )
}

function showPrivacyPreview(): Promise<{ proceed: boolean; suppress: boolean }> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center'

    const modal = document.createElement('div')
    modal.style.cssText =
      'background:var(--background,#1a1a1a);color:var(--foreground,#fff);border:1px solid var(--border,#333);border-radius:8px;padding:20px;max-width:420px;width:90%;font-family:inherit;font-size:13px;line-height:1.5'

    modal.innerHTML = `
      <p style="font-weight:600;margin-bottom:12px">What goes in the bundle?</p>
      <p style="margin-bottom:6px;color:var(--muted-foreground,#999);font-size:12px">INCLUDED</p>
      <ul style="margin:0 0 12px 16px;padding:0;color:var(--foreground,#fff);font-size:12px">
        <li>App version, platform, OS</li>
        <li>Last 7 days of log files</li>
        <li>OpenClaw config (API keys replaced with &lt;redacted&gt;)</li>
        <li>Workspace file names + sizes (no file contents)</li>
        <li>Database schema only (no message history)</li>
        <li>List of configured provider names (no key values)</li>
        <li>Service health snapshot</li>
      </ul>
      <p style="margin-bottom:6px;color:var(--muted-foreground,#999);font-size:12px">NOT INCLUDED</p>
      <ul style="margin:0 0 16px 16px;padding:0;color:var(--muted-foreground,#999);font-size:12px">
        <li>API keys or auth tokens</li>
        <li>Conversation history or messages</li>
        <li>Workspace file contents</li>
        <li>Audio recordings</li>
      </ul>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:12px;cursor:pointer">
        <input type="checkbox" id="diag-suppress" style="cursor:pointer" />
        Don't ask again
      </label>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="diag-cancel" style="padding:6px 14px;border-radius:5px;border:1px solid var(--border,#444);background:transparent;color:var(--foreground,#fff);font-size:13px;cursor:pointer">Cancel</button>
        <button id="diag-ok" style="padding:6px 14px;border-radius:5px;border:none;background:var(--primary,#4a7c59);color:#fff;font-size:13px;cursor:pointer;font-weight:500">Export</button>
      </div>
    `

    overlay.appendChild(modal)
    document.body.appendChild(overlay)

    const cleanup = () => document.body.removeChild(overlay)

    modal.querySelector('#diag-cancel')!.addEventListener('click', () => {
      cleanup()
      resolve({ proceed: false, suppress: false })
    })
    modal.querySelector('#diag-ok')!.addEventListener('click', () => {
      const suppress = (modal.querySelector('#diag-suppress') as HTMLInputElement).checked
      cleanup()
      resolve({ proceed: true, suppress })
    })
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup()
        resolve({ proceed: false, suppress: false })
      }
    })
  })
}

function relativeTime(ts: number): string {
  const diff = Math.round((Date.now() - ts) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`
  return `${Math.floor(diff / 86400)} days ago`
}

function isRealtimeModel(model: string | null): model is RealtimeModel {
  return REALTIME_MODELS.includes(model as RealtimeModel)
}

function normalizeRealtimeModel(model: string | null): RealtimeModel {
  return isRealtimeModel(model) ? model : DEFAULT_REALTIME_MODEL
}

// --- Helper Components ---

type DoctorCheckRow = {
  status: 'PASS' | 'FAIL' | 'SKIP'
  label: string
  detail: string | null
  hint: string | null
}

type DoctorResultShape = {
  checks: DoctorCheckRow[]
  passed: number
  failed: number
  skipped: number
}

function BrainDoctorPanel({
  result,
  copied,
  onCopy,
}: {
  result: DoctorResultShape
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="border-input bg-muted/30 overflow-hidden rounded-md border">
      <div className="border-input flex items-center justify-between border-b px-3 py-2">
        <span className="text-foreground text-xs font-medium">
          {result.passed} passed · {result.failed} failed · {result.skipped} skipped
        </span>
        <Button variant="ghost" size="sm" onClick={onCopy}>
          {copied ? 'Copied!' : 'Copy results'}
        </Button>
      </div>
      <ul className="divide-input divide-y">
        {result.checks.map((check, i) => (
          <li key={i} className="space-y-0.5 px-3 py-2">
            <div className="flex items-center gap-2">
              <span
                className={`text-sm leading-none ${
                  check.status === 'PASS'
                    ? 'text-[var(--brand-sage)]'
                    : check.status === 'FAIL'
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                }`}>
                {check.status === 'PASS' ? '✓' : check.status === 'FAIL' ? '✗' : '–'}
              </span>
              <span className="text-foreground text-sm">{check.label}</span>
            </div>
            {check.status === 'FAIL' && check.hint && (
              <p className="text-muted-foreground pl-5 text-xs">{check.hint}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

type ProviderKeyStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }

function VoiceModelCard({
  model,
  configuredProviders,
  onSelectModel,
  onSaved,
}: {
  model: RealtimeModel
  configuredProviders: ProviderId[]
  onSelectModel: (m: RealtimeModel) => void
  onSaved: () => void | Promise<void>
}) {
  const [editorAnchor, setEditorAnchor] = useState<RealtimeModel | null>(null)

  const handleSelect = useCallback(
    (m: RealtimeModel) => {
      onSelectModel(m)
      const provider = providerForModel(m)
      if (!configuredProviders.includes(provider)) {
        setEditorAnchor(m)
      } else {
        setEditorAnchor(null)
      }
    },
    [configuredProviders, onSelectModel]
  )

  const handleSaved = useCallback(async () => {
    await onSaved()
    setEditorAnchor(null)
  }, [onSaved])

  return (
    <Card className="space-y-4 p-4">
      <h3 className="text-foreground text-sm font-semibold">Voice Model</h3>

      <div className="space-y-1.5" role="radiogroup" aria-label="Voice model">
        {REALTIME_MODELS.map((m) => {
          const provider = providerForModel(m)
          const isConfigured = configuredProviders.includes(provider)
          const isSelected = model === m
          const isEditorOpen = editorAnchor === m
          return (
            <div key={m}>
              <ModelRow
                model={m}
                selected={isSelected}
                provider={provider}
                configured={isConfigured}
                onSelect={() => handleSelect(m)}
                onOpenEditor={() => setEditorAnchor(m)}
              />
              {isEditorOpen && (
                <InlineKeyEditor
                  provider={provider}
                  configured={isConfigured}
                  requiredForModel={isSelected && !isConfigured ? REALTIME_MODEL_LABELS[m] : null}
                  onSaved={handleSaved}
                  onClose={() => setEditorAnchor(null)}
                />
              )}
            </div>
          )
        })}
      </div>

      <div className="border-input space-y-2 border-t pt-3">
        <p className="text-muted-foreground text-[11px] tracking-wider uppercase">Key source</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="border-primary bg-accent flex items-center gap-2 rounded-md border px-3 py-2">
            <div className="border-primary flex h-3.5 w-3.5 items-center justify-center rounded-full border-2">
              <div className="bg-primary h-1.5 w-1.5 rounded-full" />
            </div>
            <span className="text-foreground text-sm font-medium">Use my API keys</span>
          </div>
          <div className="border-input bg-muted/30 flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2 opacity-60">
            <div className="flex items-center gap-2">
              <div className="border-muted-foreground h-3.5 w-3.5 rounded-full border-2" />
              <span className="text-muted-foreground text-sm">Managed by VoiceClaw</span>
            </div>
            <span className="text-muted-foreground text-[10px] tracking-wider uppercase">Soon</span>
          </div>
        </div>
      </div>
    </Card>
  )
}

function ModelRow({
  model,
  selected,
  provider,
  configured,
  onSelect,
  onOpenEditor,
}: {
  model: RealtimeModel
  selected: boolean
  provider: ProviderId
  configured: boolean
  onSelect: () => void
  onOpenEditor: () => void
}) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }
  return (
    <div
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      className={`flex w-full cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-colors ${selected ? 'border-primary bg-accent' : 'border-input'} hover:bg-accent focus-visible:ring-primary/50 focus-visible:ring-2 focus-visible:outline-none`}>
      <div
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? 'border-primary' : 'border-muted-foreground'} `}>
        {selected && <div className="bg-primary h-1.5 w-1.5 rounded-full" />}
      </div>

      <span
        className={`flex-1 truncate text-sm ${selected ? 'text-foreground font-medium' : 'text-foreground'}`}>
        {REALTIME_MODEL_LABELS[model]}
      </span>

      <span className="text-muted-foreground shrink-0 text-[11px]">
        {PROVIDER_DISPLAY_LABELS[provider]}
      </span>

      {configured ? (
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-[var(--brand-sage)]">✓ Configured</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenEditor()
            }}
            className="text-muted-foreground hover:text-foreground text-[11px] underline underline-offset-2">
            Manage
          </button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-amber-600 dark:text-amber-400">Missing key</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenEditor()
            }}
            className="border-input bg-background text-foreground hover:bg-muted rounded-md border px-2 py-0.5 text-[11px] font-medium">
            Add key
          </button>
        </div>
      )}
    </div>
  )
}

const VOICE_MODE_META: Record<VoiceMode, { label: string; helper: string; comingSoon?: boolean }> =
  {
    direct: {
      label: 'Direct',
      helper:
        'The assistant uses tools directly — read, write, edit, bash, web search. Lowest latency.',
    },
    operator: {
      label: 'Operator',
      helper:
        'Delegates to your agent (the classic ask_brain flow). Best for multi-step tasks and personal memory.',
    },
    supervisor: {
      label: 'Supervisor',
      helper:
        'A supervisor agent keeps the conversation on track — coming soon. Behaves like Direct today.',
      comingSoon: true,
    },
    'stt-tts-harness': {
      label: 'STT/TTS Harness',
      helper:
        'Speech-to-text, a Desktop-hosted Harness, and text-to-speech. Requires a Provider, Workspace, and binding below.',
    },
  }

function VoiceModeCard({ mode, onSelect }: { mode: VoiceMode; onSelect: (m: VoiceMode) => void }) {
  return (
    <Card className="space-y-4 p-4">
      <div>
        <h3 className="text-foreground text-sm font-semibold">Voice Mode</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          How the realtime model gets its capabilities.
        </p>
      </div>

      <div className="space-y-1.5" role="radiogroup" aria-label="Voice mode">
        {VOICE_MODES.map((m) => (
          <RadioOptionRow
            key={m}
            selected={mode === m}
            label={VOICE_MODE_META[m].label}
            helper={VOICE_MODE_META[m].helper}
            badge={VOICE_MODE_META[m].comingSoon ? 'coming soon' : null}
            onSelect={() => onSelect(m)}
          />
        ))}
      </div>
    </Card>
  )
}

const AGENT_BACKEND_META: Record<AgentBackend, { label: string; helper: string }> = {
  pi: {
    label: 'PI',
    helper: 'Pi Mono harness running locally. Default. Requires the pi CLI on PATH.',
  },
  openai: {
    label: 'OpenAI',
    helper: 'OpenAI Codex CLI. Requires the codex CLI on PATH.',
  },
  hermes: {
    label: 'Hermes',
    helper: 'Hermes agent. Requires the hermes CLI on PATH.',
  },
}

function AgentBackendCard({
  backend,
  onSelect,
}: {
  backend: AgentBackend
  onSelect: (b: AgentBackend) => void
}) {
  return (
    <Card className="space-y-4 p-4">
      <div>
        <h3 className="text-foreground text-sm font-semibold">Agent</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Which agent runs your tasks. Must be installed on this machine.
        </p>
      </div>

      <div className="space-y-1.5" role="radiogroup" aria-label="Agent backend">
        {AGENT_BACKENDS.map((b) => (
          <RadioOptionRow
            key={b}
            selected={backend === b}
            label={AGENT_BACKEND_META[b].label}
            helper={AGENT_BACKEND_META[b].helper}
            onSelect={() => onSelect(b)}
          />
        ))}
      </div>
    </Card>
  )
}

function RadioOptionRow({
  selected,
  label,
  helper,
  badge,
  onSelect,
}: {
  selected: boolean
  label: string
  helper: string
  badge?: string | null
  onSelect: () => void
}) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }
  return (
    <div
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      className={`flex w-full cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors ${selected ? 'border-primary bg-accent' : 'border-input'} hover:bg-accent focus-visible:ring-primary/50 focus-visible:ring-2 focus-visible:outline-none`}>
      <div
        className={`mt-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? 'border-primary' : 'border-muted-foreground'} `}>
        {selected && <div className="bg-primary h-1.5 w-1.5 rounded-full" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm ${selected ? 'text-foreground font-medium' : 'text-foreground'}`}>
            {label}
          </span>
          {badge && (
            <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] tracking-wider uppercase">
              {badge}
            </span>
          )}
        </div>
        <p className="text-muted-foreground mt-0.5 text-[11px]">{helper}</p>
      </div>
    </div>
  )
}

function InlineKeyEditor({
  provider,
  configured,
  requiredForModel,
  onSaved,
  onClose,
}: {
  provider: ProviderId
  configured: boolean
  requiredForModel: string | null
  onSaved: () => void | Promise<void>
  onClose: () => void
}) {
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [status, setStatus] = useState<ProviderKeyStatus>({ kind: 'idle' })
  const meta = PROVIDER_KEY_META[provider]
  const providerLabel = PROVIDER_LABELS[provider]

  const handleSave = useCallback(async () => {
    if (key.length < 8) {
      setStatus({ kind: 'error', message: 'Key looks too short.' })
      return
    }
    setStatus({ kind: 'saving' })
    try {
      const result = await providerApi.validateAndSave(provider, key)
      if (result.ok) {
        setStatus({ kind: 'saved' })
        setKey('')
        setShow(false)
        captureRenderer('provider_key_saved', { provider, surface: 'settings' })
        await onSaved()
      } else {
        setStatus({ kind: 'error', message: result.error })
      }
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Validation failed.',
      })
    }
  }, [provider, key, onSaved])

  return (
    <div className="border-input bg-muted/30 mt-1.5 mr-0 ml-6 space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <label className="text-foreground text-xs font-medium">{providerLabel} API key</label>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-[11px]">
          Cancel
        </button>
      </div>

      {requiredForModel && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          {providerLabel} key required to use {requiredForModel}.
        </p>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type={show ? 'text' : 'password'}
            value={key}
            onChange={(e) => {
              setKey(e.target.value)
              if (status.kind !== 'idle') setStatus({ kind: 'idle' })
            }}
            placeholder={configured ? '••••••••  (replace to update)' : meta.placeholder}
            className="pr-10"
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Hide key' : 'Show key'}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2">
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleSave()}
          disabled={status.kind === 'saving' || key.length === 0}>
          {status.kind === 'saving' ? 'Checking…' : 'Validate + save'}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <a
          href={meta.url}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground text-[11px] underline underline-offset-2">
          Get a key at {meta.linkLabel}
        </a>
        {status.kind === 'saved' && (
          <span className="text-[11px] text-[var(--brand-sage)]">Key saved.</span>
        )}
        {status.kind === 'error' && (
          <span className="text-destructive text-[11px]" role="alert">
            {status.message}
          </span>
        )}
      </div>
    </div>
  )
}

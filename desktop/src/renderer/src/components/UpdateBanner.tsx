import { useEffect, useState } from 'react'

type StagedPayload = {
  version: string
  releaseNotes: string | null
}

export function UpdateBanner({ preview = false }: { preview?: boolean }) {
  const [staged, setStaged] = useState<StagedPayload | null>(() =>
    preview ? { version: '0.11.0-preview', releaseNotes: 'Interface preview' } : null
  )
  const [dismissed, setDismissed] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (preview) return
    const api = window.electronAPI?.updates
    if (!api) return

    api
      .getState()
      .then((s) => {
        if (s.status === 'staged' && s.stagedVersion) {
          setStaged({ version: s.stagedVersion, releaseNotes: s.releaseNotes })
        }
      })
      .catch(() => {})

    const removeStaged = api.onStaged((payload) => {
      setStaged(payload)
      setDismissed(false)
    })

    const removeStateChanged = api.onStateChanged((s) => {
      if (s.stagedVersion) {
        setStaged({ version: s.stagedVersion, releaseNotes: s.releaseNotes })
      } else {
        setStaged(null)
      }
    })

    return () => {
      removeStaged()
      removeStateChanged()
    }
  }, [preview])

  if (!staged || dismissed) return null

  const handleInstall = async () => {
    setInstalling(true)
    if (preview) return
    await window.electronAPI.updates.installNow('banner')
  }

  return (
    <div className="flex flex-col bg-[var(--brand-sage)] text-sm text-white">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <span className="shrink-0 font-medium">Update ready: {staged.version}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {staged.releaseNotes && (
            <button
              onClick={() => setShowNotes((v) => !v)}
              className="rounded bg-white/20 px-2 py-0.5 text-xs whitespace-nowrap transition-colors hover:bg-white/30">
              {showNotes ? 'Hide notes ▴' : "What's new ▾"}
            </button>
          )}
          <button
            onClick={() => setDismissed(true)}
            className="rounded bg-white/20 px-2 py-0.5 text-xs transition-colors hover:bg-white/30">
            Later
          </button>
          <button
            onClick={handleInstall}
            disabled={installing}
            className="rounded bg-white px-2 py-0.5 text-xs font-semibold text-[var(--brand-sage)] transition-colors hover:bg-white/90 disabled:opacity-60">
            {installing ? 'Restarting…' : 'Restart now'}
          </button>
        </div>
      </div>
      {showNotes && staged.releaseNotes && (
        <div className="max-h-40 overflow-y-auto border-t border-white/20 px-3 pt-1.5 pb-2 text-xs whitespace-pre-wrap text-white/90">
          {staged.releaseNotes}
        </div>
      )}
    </div>
  )
}

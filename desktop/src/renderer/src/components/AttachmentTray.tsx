import { Send, X } from 'lucide-react'
import type { PendingAttachment } from '../lib/attachments'
import { Button } from './ui/Button'

interface AttachmentTrayProps {
  pending: PendingAttachment[]
  onRemove: (id: string) => void
  onSend: () => void
  sending: boolean
}

export function AttachmentTray({ pending, onRemove, onSend, sending }: AttachmentTrayProps) {
  if (pending.length === 0) return null
  return (
    <div className="mb-2 rounded-2xl border border-[var(--shell-border)] bg-[var(--shell-raised)] px-4 py-3">
      <div className="flex items-end gap-3">
        <div className="flex flex-1 flex-wrap gap-2">
          {pending.map((p) => (
            <div key={p.id} className="group relative">
              <img
                src={p.previewUrl}
                alt={p.originalName ?? 'pending attachment'}
                className="border-border h-16 w-16 rounded-md border object-cover"
              />
              <button
                type="button"
                aria-label="Remove attachment"
                onClick={() => onRemove(p.id)}
                className="bg-card border-border text-muted-foreground hover:text-destructive absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border transition-colors">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <Button onClick={onSend} disabled={sending} size="sm">
          <Send size={14} className="mr-1" />
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  )
}

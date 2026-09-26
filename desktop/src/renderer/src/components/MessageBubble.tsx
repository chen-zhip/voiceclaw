import type { MouseEvent } from 'react'
import { Keyboard } from 'lucide-react'
import { attachmentDataUrl, type Attachment, type Message } from '../lib/db'
import { formatExactTimestamp, formatLatencySummary } from '../lib/message-grouping'

interface MessageBubbleProps {
  message: Message
  attachments?: Attachment[]
  showLatency?: boolean
  showTimestamp?: boolean
  isLastInBurst?: boolean
  typed?: boolean
  onContextMenu?: (event: MouseEvent<HTMLDivElement>, message: Message) => void
}

const MD_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g
const URL_IMAGE_REGEX = /(?:^|\s)(https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp)(?:\?\S*)?)/gi

export function MessageBubble({
  message,
  attachments,
  showLatency,
  showTimestamp,
  isLastInBurst,
  typed,
  onContextMenu,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'

  const handleContextMenu = onContextMenu
    ? (e: MouseEvent<HTMLDivElement>) => {
        e.preventDefault()
        onContextMenu(e, message)
      }
    : undefined

  const burstSpacing = isLastInBurst === false ? 'mb-0.5' : 'mb-3'
  const exactTime = formatExactTimestamp(message.created_at)
  const latency = showLatency ? formatLatencySummary(message) : null

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} ${burstSpacing}`}>
      <div
        onContextMenu={handleContextMenu}
        title={exactTime}
        className={`max-w-[80%] min-w-0 rounded-md px-4 py-2.5 text-sm leading-relaxed break-words ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-card text-foreground border-border border'
        } `}>
        <MessageContent content={message.content} attachments={attachments} />
        {showTimestamp && <div className="mt-1.5 text-[10px] opacity-60">{exactTime}</div>}
        {latency && <div className="mt-1.5 text-[10px] opacity-50">{latency}</div>}
        {typed && isUser && (
          <div
            className="mt-1 flex items-center gap-1 text-[10px] opacity-60"
            title="Sent as typed text">
            <Keyboard size={10} />
            <span>typed</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function MessageContent({
  content,
  attachments,
}: {
  content: string
  attachments?: Attachment[]
}) {
  const parts = parseContent(content)
  const visibleAttachments = (attachments ?? []).filter(
    (attachment) => attachment.kind === 'image' && attachmentDataUrl(attachment) !== null
  )

  return (
    <>
      {parts.map((part, index) =>
        part.type === 'text' ? (
          <span key={index} className="whitespace-pre-wrap">
            {part.text}
          </span>
        ) : (
          <img
            key={index}
            src={part.url}
            alt={part.alt}
            className="mt-2 mb-1 max-w-full rounded-md"
            loading="lazy"
          />
        )
      )}
      {visibleAttachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {visibleAttachments.map((attachment) => {
            const url = attachmentDataUrl(attachment)
            if (!url) return null
            const name = attachment.original_name ?? 'Attached image'
            return (
              <button
                key={attachment.id}
                type="button"
                onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                className="border-border/60 hover:border-primary block overflow-hidden rounded-md border transition-colors"
                title={name}
                aria-label={name}>
                <img
                  src={url}
                  alt={name}
                  className="block max-h-64 max-w-full object-contain"
                  loading="lazy"
                />
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}

// --- Helpers ---

type ContentPart = { type: 'text'; text: string } | { type: 'image'; url: string; alt: string }

function parseContent(content: string): ContentPart[] {
  const parts: ContentPart[] = []
  let remaining = content

  // Extract markdown images
  const mdMatches = [...remaining.matchAll(MD_IMAGE_REGEX)]
  if (mdMatches.length > 0) {
    let lastIndex = 0
    for (const match of mdMatches) {
      const before = remaining.slice(lastIndex, match.index)
      if (before) parts.push({ type: 'text', text: before })
      parts.push({ type: 'image', url: match[2], alt: match[1] })
      lastIndex = match.index! + match[0].length
    }
    const after = remaining.slice(lastIndex)
    if (after) parts.push({ type: 'text', text: after })
    return parts
  }

  // Extract URL images
  const urlMatches = [...remaining.matchAll(URL_IMAGE_REGEX)]
  if (urlMatches.length > 0) {
    let lastIndex = 0
    for (const match of urlMatches) {
      const before = remaining.slice(lastIndex, match.index)
      if (before) parts.push({ type: 'text', text: before })
      parts.push({ type: 'image', url: match[1].trim(), alt: '' })
      lastIndex = match.index! + match[0].length
    }
    const after = remaining.slice(lastIndex)
    if (after) parts.push({ type: 'text', text: after })
    return parts
  }

  return [{ type: 'text', text: content }]
}

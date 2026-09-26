import type { MouseEvent } from 'react'
import type { Attachment, Message } from '../lib/db'
import { formatExactTimestamp, formatLatencySummary } from '../lib/message-grouping'
import { MessageContent } from './MessageBubble'
import { ThinkingDots } from './ThinkingDots'

interface AssistantOutputPanelProps {
  message?: Message
  text?: string
  streaming?: boolean
  waiting?: boolean
  attachments?: Attachment[]
  showLatency?: boolean
  showTimestamp?: boolean
  isLastInBurst?: boolean
  onContextMenu?: (event: MouseEvent<HTMLDivElement>, message: Message) => void
}

export function AssistantOutputPanel(props: AssistantOutputPanelProps) {
  const { message, text, streaming, waiting, isLastInBurst, onContextMenu } = props
  const content = message?.content ?? text ?? ''
  const spacing = isLastInBurst === false ? 'mb-2' : 'mb-5'
  const latency = message && props.showLatency ? formatLatencySummary(message) : null

  return (
    <div
      role="region"
      aria-label="AI output"
      aria-busy={streaming || undefined}
      className={`text-foreground w-full min-w-0 text-sm leading-relaxed break-words ${spacing}`}
      onContextMenu={
        onContextMenu && message
          ? (event) => {
              event.preventDefault()
              onContextMenu(event, message)
            }
          : undefined
      }>
      <MessageContent content={content} attachments={props.attachments} />
      {waiting && (
        <div role="status" aria-label="Waiting for AI output">
          <ThinkingDots />
        </div>
      )}
      {streaming && (
        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-current align-middle" />
      )}
      {message && props.showTimestamp && (
        <time
          className="text-muted-foreground mt-1.5 block text-[10px]"
          dateTime={new Date(message.created_at).toISOString()}>
          {formatExactTimestamp(message.created_at)}
        </time>
      )}
      {latency && <div className="text-muted-foreground mt-1.5 text-[10px]">{latency}</div>}
    </div>
  )
}

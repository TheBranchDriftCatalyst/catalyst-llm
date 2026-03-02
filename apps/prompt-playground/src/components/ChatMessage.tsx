import { User, Bot } from 'lucide-react'
import type { ChatMessage as ChatMessageType } from '../stores/chatStore'
import { cn } from '../lib/utils'

interface ChatMessageProps {
  message: ChatMessageType
  isStreaming?: boolean
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'

  return (
    <div
      className={cn(
        'flex gap-4 p-4',
        isUser ? 'bg-muted/30' : 'bg-background'
      )}
    >
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary text-secondary-foreground'
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className="flex-1 space-y-1 overflow-hidden">
        <div className="text-sm font-semibold">
          {isUser ? 'You' : 'Assistant'}
        </div>
        <div className="prose prose-sm max-w-none text-foreground">
          <div className="whitespace-pre-wrap break-words">
            {message.content}
            {isAssistant && isStreaming && message.content && (
              <span className="streaming-cursor" />
            )}
            {isAssistant && isStreaming && !message.content && (
              <span className="text-muted-foreground">Thinking...</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

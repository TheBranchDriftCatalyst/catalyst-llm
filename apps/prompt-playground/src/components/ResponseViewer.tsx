import { useState } from 'react'
import { Button } from '@/catalyst-ui/ui/button'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Chat } from '../stores/chatStore'
import { cn } from '../lib/utils'

interface ResponseViewerProps {
  chat: Chat
}

export function ResponseViewer({ chat }: ResponseViewerProps) {
  const [open, setOpen] = useState(false)

  const lastAssistantMessage = [...chat.messages]
    .reverse()
    .find(m => m.role === 'assistant')

  if (!lastAssistantMessage?.meta && !chat.streamStartTime) return null

  const meta = lastAssistantMessage?.meta
  const usage = meta?.usage

  // Calculate timing metrics
  const totalTime = chat.isStreaming
    ? Date.now() - (chat.streamStartTime || Date.now())
    : lastAssistantMessage?.timestamp && chat.streamStartTime
    ? lastAssistantMessage.timestamp - chat.streamStartTime
    : undefined

  const timeToFirstToken =
    chat.firstTokenTime && chat.streamStartTime
      ? chat.firstTokenTime - chat.streamStartTime
      : undefined

  const tokensPerSecond =
    usage?.completion_tokens && totalTime
      ? (usage.completion_tokens / (totalTime / 1000)).toFixed(1)
      : undefined

  return (
    <div className="border-t border-border">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(!open)}
        className="w-full justify-start gap-2 h-8 px-2 rounded-none"
      >
        {open ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        <span className="text-muted-foreground">Response Details</span>
        {usage && (
          <span className="ml-auto tabular-nums text-xs text-muted-foreground">
            {usage.total_tokens} tokens
          </span>
        )}
      </Button>

      {open && (
        <div className="p-3 border-t border-border bg-muted/20 text-sm space-y-3">
          {/* Metrics Grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {usage?.prompt_tokens !== undefined && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Prompt tokens:</span>
                <span className="tabular-nums">{usage.prompt_tokens}</span>
              </div>
            )}
            {usage?.completion_tokens !== undefined && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Completion tokens:</span>
                <span className="tabular-nums">{usage.completion_tokens}</span>
              </div>
            )}
            {totalTime !== undefined && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total time:</span>
                <span className="tabular-nums">
                  {(totalTime / 1000).toFixed(2)}s
                </span>
              </div>
            )}
            {timeToFirstToken !== undefined && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">First token:</span>
                <span className="tabular-nums">{timeToFirstToken}ms</span>
              </div>
            )}
            {tokensPerSecond && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tokens/sec:</span>
                <span className="tabular-nums">{tokensPerSecond}</span>
              </div>
            )}
            {meta?.finish_reason && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Finish reason:</span>
                <span className="tabular-nums">{meta.finish_reason}</span>
              </div>
            )}
          </div>

          {/* Raw Response */}
          {meta && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Raw metadata
              </summary>
              <pre className="mt-2 p-2 bg-background rounded-md overflow-auto max-h-48 border border-border">
                {JSON.stringify(meta, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

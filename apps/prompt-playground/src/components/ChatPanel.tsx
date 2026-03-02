import { useState, useRef, useEffect, useCallback, type FormEvent } from 'react'
import { Button } from '@/catalyst-ui/ui/button'
import { Textarea } from '@/catalyst-ui/ui/textarea'
import { Card, CardContent } from '@/catalyst-ui/ui/card'
import { Send, Square, Trash2 } from 'lucide-react'
import { useChatStore, type Chat } from '../stores/chatStore'
import { ChatMessage } from './ChatMessage'
import { ModelSelector } from './ModelSelector'
import { ParameterControls } from './ParameterControls'
import { SystemPromptEditor } from './SystemPromptEditor'
import { ResponseViewer } from './ResponseViewer'

interface ChatPanelProps {
  chat: Chat
}

export function ChatPanel({ chat }: ChatPanelProps) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const {
    sendMessage,
    stopStreaming,
    clearChat,
    setModel,
    setSystemPrompt,
    setParams,
  } = useChatStore()

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [chat.messages, scrollToBottom])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const message = input.trim()
    if (!message || chat.isStreaming || !chat.model) return

    setInput('')
    await sendMessage(chat.id, message)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
    }
  }, [input])

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-72 border-r border-border p-4 space-y-6 overflow-y-auto shrink-0 bg-muted/10">
        <ModelSelector
          value={chat.model}
          onChange={model => setModel(chat.id, model)}
        />

        <SystemPromptEditor
          value={chat.systemPrompt}
          onChange={prompt => setSystemPrompt(chat.id, prompt)}
        />

        <ParameterControls
          params={chat.params}
          onChange={params => setParams(chat.id, params)}
        />

        <div className="pt-4 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={() => clearChat(chat.id)}
            disabled={chat.isStreaming || chat.messages.length === 0}
            className="w-full"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Clear Chat
          </Button>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          {chat.messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {chat.model ? (
                <Card interactive={false} className="max-w-md">
                  <CardContent className="pt-6 text-center">
                    <p className="text-lg font-medium mb-2">Start a conversation</p>
                    <p className="text-sm text-muted-foreground">
                      Type a message below to begin chatting with {chat.model}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <Card interactive={false} className="max-w-md">
                  <CardContent className="pt-6 text-center">
                    <p className="text-lg font-medium mb-2">Select a model</p>
                    <p className="text-sm text-muted-foreground">
                      Choose a model from the sidebar to get started
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {chat.messages.map((message, idx) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  isStreaming={
                    chat.isStreaming && idx === chat.messages.length - 1
                  }
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Error Display */}
        {chat.error && (
          <div className="mx-4 mb-2 p-3 text-sm bg-destructive/10 border border-destructive/20 rounded-md text-destructive">
            {chat.error}
          </div>
        )}

        {/* Response Details */}
        <ResponseViewer chat={chat} />

        {/* Input Area */}
        <form onSubmit={handleSubmit} className="p-4 border-t border-border bg-background">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={chat.model ? 'Type a message...' : 'Select a model first'}
                disabled={!chat.model}
                rows={1}
                className="min-h-[44px] max-h-[200px] resize-none pr-12"
              />
            </div>

            {chat.isStreaming ? (
              <Button
                type="button"
                variant="destructive"
                size="icon"
                onClick={() => stopStreaming(chat.id)}
                title="Stop generating"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim() || !chat.model}
                title="Send message"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Press Enter to send, Shift+Enter for new line
          </div>
        </form>
      </div>
    </div>
  )
}

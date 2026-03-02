import { Tabs, TabsList, TabsTrigger } from '@/catalyst-ui/ui/tabs'
import { Button } from '@/catalyst-ui/ui/button'
import { Plus, X } from 'lucide-react'
import { useChatStore } from '../stores/chatStore'
import { cn } from '../lib/utils'

export function ChatTabs() {
  const { chats, activeChat, addChat, removeChat, setActiveChat } = useChatStore()

  return (
    <div className="border-b border-border bg-muted/20">
      <Tabs value={activeChat} onValueChange={setActiveChat}>
        <div className="flex items-center px-2 py-1">
          <TabsList className="h-auto bg-transparent p-0 gap-1">
            {chats.map(chat => (
              <TabsTrigger
                key={chat.id}
                value={chat.id}
                className={cn(
                  'group relative flex items-center gap-2 px-3 py-1.5 text-sm rounded-md',
                  'border border-transparent',
                  'data-[state=active]:bg-background data-[state=active]:border-border',
                  'data-[state=active]:shadow-sm',
                  'hover:bg-muted/50 transition-colors',
                  'max-w-[180px]'
                )}
              >
                <span className="truncate">
                  {chat.model || chat.name}
                </span>
                {chat.isStreaming && (
                  <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse shrink-0" />
                )}
                {chats.length > 1 && (
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      removeChat(chat.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 transition-opacity shrink-0"
                    title="Close chat"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => addChat()}
            className="ml-1 shrink-0"
            title="New chat"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </Tabs>
    </div>
  )
}

import { useChatStore } from './stores/chatStore'
import { ChatTabs } from './components/ChatTabs'
import { ChatPanel } from './components/ChatPanel'
import { ThemeSwitcher } from './components/ThemeSwitcher'
import { DevModeToggle } from '@/catalyst-ui/dev'
import { getLiteLLMUrl, hasApiKey } from './lib/litellm'
import { cn } from './lib/utils'
import { ExternalLink } from 'lucide-react'

function App() {
  const { chats, activeChat } = useChatStore()
  const currentChat = chats.find(c => c.id === activeChat)
  const litellmUrl = getLiteLLMUrl()

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border px-4 py-3 flex items-center justify-between shrink-0 bg-card">
        <h1 className="text-lg font-bold tracking-wider">Prompt Playground</h1>
        <div className="flex items-center gap-4">
          {/* LiteLLM Navigation */}
          <nav className="flex items-center gap-3 text-sm">
            <a
              href={`${litellmUrl}/ui`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>LiteLLM UI</span>
              <ExternalLink className="h-3 w-3" />
            </a>
            <a
              href={`${litellmUrl}/docs`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>API Docs</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </nav>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                hasApiKey() ? 'bg-green-500' : 'bg-yellow-500'
              )}
            />
            <span className="hidden sm:inline">{litellmUrl}</span>
          </div>
          <ThemeSwitcher />
          <DevModeToggle />
        </div>
      </header>

      {/* Tab Bar */}
      <ChatTabs />

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        {currentChat ? (
          <ChatPanel key={currentChat.id} chat={currentChat} />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            No chat selected
          </div>
        )}
      </main>
    </div>
  )
}

export default App

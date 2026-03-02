import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from './contexts/ThemeContext'
import { DevProviders } from '@/catalyst-ui/dev'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <DevProviders>
        <App />
      </DevProviders>
    </ThemeProvider>
  </StrictMode>,
)

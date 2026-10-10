import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans-sc'
import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ConversationsProvider } from '@/stores/conversationsStore'
import { LabJobsProvider } from '@/stores/labJobsStore'
import { applyHostPlatform, attachWindowMaximizeDblClick, syncWindowChrome } from '@/lib/hostPlatform'
import { applyUiEmphasis } from '@/lib/uiEmphasis'
import { applyConversationFontSize, subscribeConversationFontSizeSync } from '@/lib/uiFonts'
import { applyProjectFoldLimit, subscribeProjectFoldLimitSync } from '@/lib/projectFoldLimit'
import { applyThemeMode, readThemeMode, resolveThemeMode, subscribeThemeSync } from '@/lib/themeMode'
import './index.css'

const initialThemeMode = readThemeMode()
applyHostPlatform()
attachWindowMaximizeDblClick()
applyThemeMode(initialThemeMode)
syncWindowChrome(resolveThemeMode(initialThemeMode), globalThis, initialThemeMode)
subscribeThemeSync((mode, resolved) => {
  applyThemeMode(mode, document.documentElement, resolved === 'dark')
  syncWindowChrome(resolved, globalThis, mode)
  applyUiEmphasis({ theme: resolved })
})
subscribeConversationFontSizeSync(size => {
  applyConversationFontSize(size, { sync: false })
})
subscribeProjectFoldLimitSync(limit => {
  applyProjectFoldLimit(limit, { sync: false })
})
document.documentElement.dataset.colorScheme = 'memoh'
try {
  const surface = new URLSearchParams(window.location.search).get('surface') || ''
  if (surface === 'companion' || surface === 'companion-chat') {
    document.documentElement.classList.add('companion-surface')
    document.body.classList.add('companion-surface')
  }
} catch {
  // Surface query is only present in the desktop pet window.
}

class BootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; stack: string }> {
  state = { error: null as Error | null, stack: '' }

  static getDerivedStateFromError(error: Error) {
    return { error, stack: error.stack || '' }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[boot]', error, info.componentStack)
    this.setState({ stack: `${error.stack || ''}\n${info.componentStack || ''}` })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <pre style={{ padding: 24, color: '#b91c1c', whiteSpace: 'pre-wrap', fontSize: 13 }}>
        {this.state.error.message}
        {'\n'}
        {this.state.stack}
      </pre>
    )
  }
}

const root = document.getElementById('app')
if (!root) throw new Error('MilkSU renderer root #app is missing')
createRoot(root).render(
  <StrictMode>
    <BootErrorBoundary>
      <ConversationsProvider>
        <LabJobsProvider>
          <App />
        </LabJobsProvider>
      </ConversationsProvider>
    </BootErrorBoundary>
  </StrictMode>,
)

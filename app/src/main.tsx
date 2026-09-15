import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans-sc'
import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ConversationsProvider } from '@/stores/conversationsStore'
import { LabJobsProvider } from '@/stores/labJobsStore'
import { applyHostPlatform } from '@/lib/hostPlatform'
import './index.css'

applyHostPlatform()
document.documentElement.dataset.colorScheme = 'memoh'

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

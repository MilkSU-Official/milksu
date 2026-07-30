import { Component, useCallback, useEffect, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import i18next from 'i18next'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { OutputPanel } from './components/OutputPanel'
import { SettingsPage } from './components/SettingsPage'
import { RuntimePage } from './components/RuntimePage'
import { CTFPage } from './components/CTFPage'
import { VulnPage } from './components/VulnPage'
import { invokeCommand } from './desktop'
import { useConversations } from './hooks/useConversations'
import { useAgentEvents } from './hooks/useAgentEvents'
import type { AppSettings, Conversation, Message } from './types'

export default function App() {
  const {
    conversations,
    setConversations,
    active,
    activeId,
    setActiveId,
    persistConversation,
    scheduleSave,
    loadConversations,
    deleteConversation,
    updateConversation,
  } = useConversations()

  const [showOutput, setShowOutput] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showRuntime, setShowRuntime] = useState(false)
  const [showCTF, setShowCTF] = useState(false)
  const [showVuln, setShowVuln] = useState(false)
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    invokeCommand<AppSettings>('get_settings').then(loadedSettings => {
      setSettings(loadedSettings)
      if (loadedSettings.locale) void i18next.changeLanguage(loadedSettings.locale)
    })
    loadConversations()
  }, [loadConversations])

  useAgentEvents(setConversations, scheduleSave)

  const handleNew = useCallback(() => {
    setActiveId(null)
    setShowOutput(false)
    setShowSettings(false)
    setShowRuntime(false)
    setShowCTF(false)
    setShowVuln(false)
  }, [setActiveId])

  const handleSend = useCallback(async (text: string) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }

    let conversationId = activeId
    if (!conversationId) {
      conversationId = crypto.randomUUID()
      const conversation: Conversation = {
        id: conversationId,
        title: text.slice(0, 40),
        createdAt: Date.now(),
        messages: [userMessage],
      }
      setConversations(previous => {
        const updated = [conversation, ...previous]
        persistConversation(conversation)
        return updated
      })
      setActiveId(conversationId)
    } else {
      updateConversation(conversationId, conversation => ({
        ...conversation,
        title: conversation.messages.length === 0 ? text.slice(0, 40) : conversation.title,
        messages: [...conversation.messages, userMessage],
      }))
    }

    try {
      await invokeCommand('send_message', { conversationId, prompt: text })
    } catch (error) {
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${error}`,
        timestamp: Date.now(),
      }
      updateConversation(conversationId, conversation => ({
        ...conversation,
        messages: [...conversation.messages, errorMessage],
      }))
    }
  }, [activeId, persistConversation, setActiveId, setConversations, updateConversation])

  const handleChangeModel = useCallback(async (provider: string, model: string) => {
    if (!settings) return
    const updated = { ...settings, active_provider: provider, active_model: model }
    setSettings(updated)
    try {
      await invokeCommand('save_settings_cmd', { newSettings: updated })
    } catch (error) {
      console.error('Failed to save model selection:', error)
    }
  }, [settings])

  if (showSettings) {
    return (
      <div className="flex h-screen bg-white text-[#1a1a1a]">
        <SettingsPage
          settings={settings}
          onSettingsChange={setSettings}
          onClose={() => {
            setShowSettings(false)
            invokeCommand<AppSettings>('get_settings').then(loadedSettings => {
              setSettings(loadedSettings)
              if (loadedSettings.locale) void i18next.changeLanguage(loadedSettings.locale)
            })
          }}
          conversations={conversations}
        />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-white text-[#1a1a1a]">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={id => {
          setActiveId(id)
          setShowOutput(false)
          setShowRuntime(false)
          setShowCTF(false)
          setShowVuln(false)
        }}
        onNew={handleNew}
        onDelete={deleteConversation}
        onOpenSettings={() => setShowSettings(true)}
        onOpenRuntime={() => {
          setShowRuntime(true)
          setShowCTF(false)
          setShowVuln(false)
          setShowOutput(false)
        }}
        onOpenCTF={() => {
          setShowCTF(true)
          setShowVuln(false)
          setShowRuntime(false)
          setShowOutput(false)
        }}
        onOpenVuln={() => {
          setShowVuln(true)
          setShowCTF(false)
          setShowRuntime(false)
          setShowOutput(false)
        }}
        activeSection={showVuln ? 'vuln' : showCTF ? 'ctf' : showRuntime ? 'runtime' : 'chat'}
      />
      <div className="flex min-w-0 flex-1">
        {showVuln ? (
          <WorkspaceErrorBoundary workspace="漏洞研究">
            <VulnPage onOpenSettings={() => setShowSettings(true)} />
          </WorkspaceErrorBoundary>
        ) : showCTF ? (
          <CTFErrorBoundary>
            <CTFPage onOpenSettings={() => setShowSettings(true)} />
          </CTFErrorBoundary>
        ) : showRuntime ? (
          <RuntimePage onOpenSettings={() => setShowSettings(true)} />
        ) : (
          <>
            <ChatView
              conversation={active}
              onSend={handleSend}
              onToggleOutput={() => setShowOutput(previous => !previous)}
              settings={settings}
              onChangeModel={handleChangeModel}
              onOpenSettings={() => setShowSettings(true)}
            />
            {showOutput && <OutputPanel conversation={active} />}
          </>
        )}
      </div>
    </div>
  )
}

class CTFErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('CTF workspace render failed', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center bg-[#f3f1ec] px-8">
        <div className="max-w-lg rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-red-600">CTF workspace error</p>
          <h1 className="mt-2 text-lg font-semibold text-[#292927]">界面没有吞掉这次错误</h1>
          <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-red-50 p-3 font-mono text-[11px] leading-5 text-red-800">{this.state.error.message}</pre>
          <button type="button" onClick={() => this.setState({ error: null })} className="mt-4 rounded-lg border border-[#d8d8d2] px-3 py-2 text-xs font-medium hover:bg-[#f5f5f2]">重新渲染</button>
        </div>
      </main>
    )
  }
}

class WorkspaceErrorBoundary extends Component<{ children: ReactNode; workspace: string }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Workspace render failed', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center bg-[#f8f8f5] px-8">
        <div className="max-w-lg rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-red-600">{this.props.workspace} workspace error</p>
          <h1 className="mt-2 text-lg font-semibold text-[#292927]">界面没有吞掉这次错误</h1>
          <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-red-50 p-3 font-mono text-[11px] leading-5 text-red-800">{this.state.error.message}</pre>
          <button type="button" onClick={() => this.setState({ error: null })} className="mt-4 rounded-lg border border-[#d8d8d2] px-3 py-2 text-xs font-medium hover:bg-[#f5f5f2]">重新渲染</button>
        </div>
      </main>
    )
  }
}

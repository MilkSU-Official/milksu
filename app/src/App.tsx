import { useCallback, useEffect, useState } from 'react'
import i18next from 'i18next'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { OutputPanel } from './components/OutputPanel'
import { SettingsPage } from './components/SettingsPage'
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
        }}
        onNew={handleNew}
        onDelete={deleteConversation}
        onOpenSettings={() => setShowSettings(true)}
      />
      <div className="flex min-w-0 flex-1">
        <ChatView
          conversation={active}
          onSend={handleSend}
          onToggleOutput={() => setShowOutput(previous => !previous)}
          settings={settings}
          onChangeModel={handleChangeModel}
          onOpenSettings={() => setShowSettings(true)}
        />
        {showOutput && <OutputPanel conversation={active} />}
      </div>
    </div>
  )
}

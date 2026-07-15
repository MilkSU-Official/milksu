import { useState, useCallback, useEffect, useMemo } from 'react'
import i18next from 'i18next'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { OutputPanel } from './components/OutputPanel'
import { TaskPanel } from './components/TaskPanel'
import { SettingsPage } from './components/SettingsPage'
import { invokeCommand, listEngagements, getEngagement } from './tauri'
import { useConversations } from './hooks/useConversations'
import { useAgentEvents } from './hooks/useAgentEvents'
import { deriveTaskState } from './hooks/useDerivedState'
import type { Conversation, Message, Engagement, AppSettings, TaskType, EngagementSummary } from './types'

export default function App() {
  const {
    conversations, setConversations, active, activeId, activeIdRef, setActiveId,
    persistConversation, scheduleSave, loadConversations, deleteConversation, updateConversation,
  } = useConversations()

  const [showOutput, setShowOutput] = useState(false)
  const [showTaskPanel, setShowTaskPanel] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [pendingTaskType, setPendingTaskType] = useState<TaskType>('chat')
  const [pendingEngagementId, setPendingEngagementId] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [engagements, setEngagements] = useState<EngagementSummary[]>([])
  const [activeEngagement, setActiveEngagement] = useState<Engagement | null>(null)

  useEffect(() => {
    if (active?.engagementId) {
      getEngagement(active.engagementId).then(setActiveEngagement).catch(() => setActiveEngagement(null))
    } else {
      setActiveEngagement(null)
    }
  }, [active?.engagementId])

  const effectiveTaskState = useMemo(() => {
    if (activeEngagement && active) {
      const derived = deriveTaskState(activeEngagement, active.taskType)
      if (derived && active.taskState) {
        return { ...derived, ...active.taskState } as typeof derived
      }
      return derived ?? active.taskState
    }
    return active?.taskState
  }, [active, activeEngagement])

  useEffect(() => {
    invokeCommand<AppSettings>('get_settings').then(loadedSettings => {
      setSettings(loadedSettings)
      if (loadedSettings.locale) void i18next.changeLanguage(loadedSettings.locale)
    })
    loadConversations()
    listEngagements().then(setEngagements).catch(console.error)
  }, [loadConversations])

  useAgentEvents(setConversations, scheduleSave, persistConversation, activeIdRef, setShowTaskPanel)

  const handleNew = useCallback(() => {
    setActiveId(null)
    setShowOutput(false)
    setShowTaskPanel(false)
    setShowSettings(false)
    setPendingTaskType('chat')
    setPendingEngagementId(null)
  }, [setActiveId])

  const handleSend = useCallback(async (text: string) => {
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }

    let convId = activeId
    if (!convId) {
      convId = crypto.randomUUID()
      const taskType = pendingTaskType
      const conv: Conversation = {
        id: convId,
        title: text.slice(0, 40),
        createdAt: Date.now(),
        messages: [userMsg],
        taskType,
        engagementId: taskType === 'chat' ? null : pendingEngagementId,
      }
      setConversations(prev => {
        const updated = [conv, ...prev]
        persistConversation(conv)
        return updated
      })
      setActiveId(convId)
      if (taskType !== 'chat') {
        setShowTaskPanel(true)
        setShowOutput(false)
      }
    } else {
      updateConversation(convId, c => {
        const title = c.messages.length === 0 ? text.slice(0, 40) : c.title
        return { ...c, title, messages: [...c.messages, userMsg] }
      })
    }

    try {
      await invokeCommand('send_message', { conversationId: convId, prompt: text })
    } catch (err) {
      const errMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${err}`,
        timestamp: Date.now(),
      }
      updateConversation(convId!, c => ({ ...c, messages: [...c.messages, errMsg] }))
    }
  }, [activeId, pendingTaskType, pendingEngagementId, setConversations, setActiveId, persistConversation, updateConversation])

  const handleChangeModel = useCallback(async (provider: string, model: string) => {
    if (!settings) return
    const updated = { ...settings, active_provider: provider, active_model: model }
    setSettings(updated)
    try {
      await invokeCommand('save_settings_cmd', { newSettings: updated })
    } catch (err) {
      console.error('Failed to save model selection:', err)
    }
  }, [settings])

  const handleEngagementChange = useCallback((id: string | null) => {
    if (!activeId) {
      setPendingEngagementId(id)
      return
    }
    updateConversation(activeId, c => ({ ...c, engagementId: id }))
  }, [activeId, updateConversation])

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
        onSelect={(id) => {
          setActiveId(id)
          setShowSettings(false)
          const conv = conversations.find(c => c.id === id)
          if (conv && conv.taskType !== 'chat') {
            setShowTaskPanel(true)
            setShowOutput(false)
          } else {
            setShowTaskPanel(false)
          }
        }}
        onNew={handleNew}
        onDelete={deleteConversation}
        onOpenSettings={() => setShowSettings(true)}
      />
      <div className="flex-1 flex min-w-0 relative">
        <ChatView
          conversation={active}
          onSend={handleSend}
          onToggleOutput={() => {
            if (active?.taskType && active.taskType !== 'chat') {
              setShowTaskPanel(!showTaskPanel)
            } else {
              setShowOutput(!showOutput)
            }
          }}
          settings={settings}
          onChangeModel={handleChangeModel}
          onOpenSettings={() => setShowSettings(true)}
          pendingTaskType={pendingTaskType}
          onTaskTypeChange={(taskType: TaskType) => {
            setPendingTaskType(taskType)
            if (taskType === 'chat') setPendingEngagementId(null)
          }}
          engagements={engagements}
          selectedEngagementId={active ? active.engagementId ?? null : pendingEngagementId}
          onEngagementChange={handleEngagementChange}
          onEngagementsChange={setEngagements}
        />
        {showTaskPanel && active?.taskType && active.taskType !== 'chat' && (
          <div className="absolute inset-y-0 right-0 z-10 shadow-xl">
            <TaskPanel
              taskType={active.taskType}
              taskState={effectiveTaskState}
              onClose={() => setShowTaskPanel(false)}
            />
          </div>
        )}
        {showOutput && (!active || active.taskType === 'chat') && (
          <OutputPanel conversation={active} />
        )}
      </div>
    </div>
  )
}

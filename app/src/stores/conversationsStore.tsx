import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { useStore } from '@/lib/reactStore'
import { createConversationsRuntime, type ConversationsRuntime } from '@/composables/useConversations'

const ConversationsContext = createContext<ConversationsRuntime | null>(null)

export function ConversationsProvider({ children }: { children: ReactNode }) {
  const runtimeRef = useRef<ConversationsRuntime | null>(null)
  if (!runtimeRef.current) runtimeRef.current = createConversationsRuntime({ live: true })
  useEffect(() => {
    const runtime = runtimeRef.current
    return () => runtime?.dispose()
  }, [])
  return (
    <ConversationsContext.Provider value={runtimeRef.current}>
      {children}
    </ConversationsContext.Provider>
  )
}

export function useConversations(): ConversationsRuntime {
  const runtime = useContext(ConversationsContext)
  if (!runtime) throw new Error('useConversations requires ConversationsProvider')
  useStore(runtime.store)
  return runtime
}

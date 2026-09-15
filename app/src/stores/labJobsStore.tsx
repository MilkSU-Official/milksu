import { createContext, useContext, useRef, type ReactNode } from 'react'
import { useStore } from '@/lib/reactStore'
import { createLabJobsRuntime, labJobsStore, type LabJobsRuntime } from '@/composables/useLabJobs'

const LabJobsContext = createContext<LabJobsRuntime | null>(null)

export function LabJobsProvider({ children }: { children: ReactNode }) {
  const runtimeRef = useRef<LabJobsRuntime | null>(null)
  if (!runtimeRef.current) runtimeRef.current = createLabJobsRuntime()
  return (
    <LabJobsContext.Provider value={runtimeRef.current}>
      {children}
    </LabJobsContext.Provider>
  )
}

export function useLabJobs(): LabJobsRuntime {
  const runtime = useContext(LabJobsContext)
  if (!runtime) throw new Error('useLabJobs requires LabJobsProvider')
  useStore(labJobsStore)
  return runtime
}

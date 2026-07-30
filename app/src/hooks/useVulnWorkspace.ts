import { useCallback, useEffect, useRef, useState } from 'react'
import { invokeCommand, listenEvent } from '../desktop'
import type { RuntimeEvent } from '../runtimeTypes'
import type {
  VulnLearningRecordRequest,
  VulnProjection,
  VulnReproductionRequest,
  VulnSummary,
} from '../vulnTypes'

export function useVulnWorkspace() {
  const [jobs, setJobs] = useState<VulnSummary[]>([])
  const [selectedId, setSelectedIdState] = useState<string | null>(null)
  const [projection, setProjection] = useState<VulnProjection | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const refreshTimer = useRef<number | null>(null)

  const setSelectedId = useCallback((id: string | null) => {
    selectedIdRef.current = id
    setSelectedIdState(id)
  }, [])

  const loadJobs = useCallback(async () => {
    setLoading(true)
    try {
      const current = selectedIdRef.current
      const loaded = await invokeCommand<VulnSummary[]>('list_vuln_jobs')
      const nextId = current && loaded.some(job => job.id === current) ? current : (loaded[0]?.id ?? null)
      setJobs(loaded)
      setSelectedId(nextId)
      setProjection(nextId ? await invokeCommand<VulnProjection>('get_vuln_job', { id: nextId }) : null)
      setError(null)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setLoading(false)
    }
  }, [setSelectedId])

  const selectJob = useCallback(async (id: string) => {
    setSelectedId(id)
    try {
      setProjection(await invokeCommand<VulnProjection>('get_vuln_job', { id }))
      setError(null)
    } catch (reason) {
      setError(String(reason))
    }
  }, [setSelectedId])

  const startFixture = useCallback(async () => {
    setWorking(true)
    try {
      const started = await invokeCommand<VulnProjection>('start_packet_parser_research')
      setSelectedId(started.job.id)
      setProjection(started)
      setJobs(await invokeCommand<VulnSummary[]>('list_vuln_jobs'))
      setError(null)
      return true
    } catch (reason) {
      setError(String(reason))
      return false
    } finally {
      setWorking(false)
    }
  }, [setSelectedId])

  const submitReproduction = useCallback(async (id: string, request: VulnReproductionRequest) => {
    setWorking(true)
    try {
      const updated = await invokeCommand<VulnProjection>('submit_vuln_reproduction', { id, request })
      setProjection(updated)
      setJobs(await invokeCommand<VulnSummary[]>('list_vuln_jobs'))
      setError(null)
      return true
    } catch (reason) {
      setError(String(reason))
      return false
    } finally {
      setWorking(false)
    }
  }, [])

  const recordLearning = useCallback(async (id: string, request: VulnLearningRecordRequest) => {
    setWorking(true)
    try {
      const updated = await invokeCommand<VulnProjection>('record_vuln_learning', { id, request })
      setProjection(updated)
      setError(null)
      return true
    } catch (reason) {
      setError(String(reason))
      return false
    } finally {
      setWorking(false)
    }
  }, [])

  useEffect(() => {
    void loadJobs()
  }, [loadJobs])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    const refresh = async () => {
      refreshTimer.current = null
      if (disposed) return
      const current = selectedIdRef.current
      try {
        const [loadedJobs, loadedProjection] = await Promise.all([
          invokeCommand<VulnSummary[]>('list_vuln_jobs'),
          current ? invokeCommand<VulnProjection>('get_vuln_job', { id: current }) : Promise.resolve(null),
        ])
        if (disposed) return
        setJobs(loadedJobs)
        if (loadedProjection) setProjection(loadedProjection)
      } catch (reason) {
        if (!disposed) setError(String(reason))
      }
    }

    void listenEvent<RuntimeEvent>('job-event', () => {
      if (refreshTimer.current === null) {
        refreshTimer.current = window.setTimeout(() => void refresh(), 64)
      }
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })

    return () => {
      disposed = true
      unlisten?.()
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current)
      refreshTimer.current = null
    }
  }, [])

  return {
    jobs,
    selectedId,
    projection,
    loading,
    working,
    error,
    loadJobs,
    selectJob,
    startFixture,
    submitReproduction,
    recordLearning,
  }
}

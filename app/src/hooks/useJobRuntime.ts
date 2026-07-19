import { useCallback, useEffect, useRef, useState } from 'react'
import { invokeCommand, listenEvent } from '../desktop'
import type { JobProjection, JobSummary, RuntimeEvent } from '../runtimeTypes'

export function useJobRuntime() {
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [selectedId, setSelectedIdState] = useState<string | null>(null)
  const [projection, setProjection] = useState<JobProjection | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const pendingJobIds = useRef(new Set<string>())
  const refreshTimer = useRef<number | null>(null)

  const setSelectedId = useCallback((id: string | null) => {
    selectedIdRef.current = id
    setSelectedIdState(id)
  }, [])

  const loadJobs = useCallback(async () => {
    setLoading(true)
    try {
      const loaded = await invokeCommand<JobSummary[]>('list_jobs')
      setJobs(loaded)
      const current = selectedIdRef.current
      const nextId = current && loaded.some(job => job.id === current) ? current : loaded[0]?.id ?? null
      setSelectedId(nextId)
      if (nextId) {
        setProjection(await invokeCommand<JobProjection>('get_job', { id: nextId }))
      } else {
        setProjection(null)
      }
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
      setProjection(await invokeCommand<JobProjection>('get_job', { id }))
      setError(null)
    } catch (reason) {
      setError(String(reason))
    }
  }, [setSelectedId])

  const startJob = useCallback(async () => {
    setCreating(true)
    try {
      const started = await invokeCommand<JobProjection>('start_walking_skeleton', {
        title: 'M1 可恢复事实链',
      })
      setSelectedId(started.job.id)
      setProjection(started)
      setJobs(await invokeCommand<JobSummary[]>('list_jobs'))
      setError(null)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setCreating(false)
    }
  }, [setSelectedId])

  const cancelJob = useCallback(async (id: string) => {
    try {
      await invokeCommand('cancel_job', { id })
      const [loadedJobs, loadedProjection] = await Promise.all([
        invokeCommand<JobSummary[]>('list_jobs'),
        invokeCommand<JobProjection>('get_job', { id }),
      ])
      setJobs(loadedJobs)
      if (selectedIdRef.current === id) setProjection(loadedProjection)
      setError(null)
    } catch (reason) {
      setError(String(reason))
    }
  }, [])

  useEffect(() => {
    void loadJobs()
  }, [loadJobs])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    const pendingIds = pendingJobIds.current

    const flush = async () => {
      refreshTimer.current = null
      const ids = [...pendingIds]
      pendingIds.clear()
      if (ids.length === 0 || disposed) return
      try {
        const [loadedJobs, ...projections] = await Promise.all([
          invokeCommand<JobSummary[]>('list_jobs'),
          ...ids.map(id => invokeCommand<JobProjection>('get_job', { id })),
        ])
        if (disposed) return
        setJobs(loadedJobs)
        const selected = selectedIdRef.current
        const updated = projections.find(value => value.job.id === selected)
        if (updated) setProjection(updated)
      } catch (reason) {
        if (!disposed) setError(String(reason))
      }
    }

    void listenEvent<RuntimeEvent>('job-event', event => {
      pendingIds.add(event.payload.jobId)
      if (refreshTimer.current === null) {
        refreshTimer.current = window.setTimeout(() => void flush(), 48)
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
      pendingIds.clear()
    }
  }, [])

  return {
    jobs,
    selectedId,
    projection,
    loading,
    creating,
    error,
    loadJobs,
    selectJob,
    startJob,
    cancelJob,
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { invokeCommand, listenEvent } from '../desktop'
import type { CTFChallengeRequest, CTFProjection, CTFSummary } from '../ctfTypes'
import type { RuntimeEvent } from '../runtimeTypes'

export function useCTFWorkspace() {
  const [jobs, setJobs] = useState<CTFSummary[]>([])
  const [selectedId, setSelectedIdState] = useState<string | null>(null)
  const [projection, setProjection] = useState<CTFProjection | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
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
      const [loaded, currentProjection] = await Promise.all([
        invokeCommand<CTFSummary[]>('list_ctf_jobs'),
        current ? invokeCommand<CTFProjection>('get_ctf_job', { id: current }) : Promise.resolve(null),
      ])
      setJobs(loaded)
      if (currentProjection && loaded.some(job => job.id === currentProjection.job.id)) {
        setProjection(currentProjection)
      } else {
        const nextId = loaded[0]?.id ?? null
        setSelectedId(nextId)
        setProjection(nextId ? await invokeCommand<CTFProjection>('get_ctf_job', { id: nextId }) : null)
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
      setProjection(await invokeCommand<CTFProjection>('get_ctf_job', { id }))
      setError(null)
    } catch (reason) {
      setError(String(reason))
    }
  }, [setSelectedId])

  const start = useCallback(async (command: 'start_sample_ctf' | 'start_ctf_challenge', request?: CTFChallengeRequest) => {
    setCreating(true)
    try {
      const started = await invokeCommand<CTFProjection>(command, request ? { request } : undefined)
      setSelectedId(started.job.id)
      setProjection(started)
      setJobs(await invokeCommand<CTFSummary[]>('list_ctf_jobs'))
      setError(null)
      return true
    } catch (reason) {
      setError(String(reason))
      return false
    } finally {
      setCreating(false)
    }
  }, [setSelectedId])

  const startSample = useCallback(() => start('start_sample_ctf'), [start])
  const startChallenge = useCallback((request: CTFChallengeRequest) => start('start_ctf_challenge', request), [start])

  const cancelJob = useCallback(async (id: string) => {
    try {
      await invokeCommand('cancel_ctf_job', { id })
      const [loadedJobs, loadedProjection] = await Promise.all([
        invokeCommand<CTFSummary[]>('list_ctf_jobs'),
        invokeCommand<CTFProjection>('get_ctf_job', { id }),
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

    const flush = async () => {
      refreshTimer.current = null
      if (disposed) return
      const selected = selectedIdRef.current
      try {
        const [loadedJobs, loadedProjection] = await Promise.all([
          invokeCommand<CTFSummary[]>('list_ctf_jobs'),
          selected ? invokeCommand<CTFProjection>('get_ctf_job', { id: selected }) : Promise.resolve(null),
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
        refreshTimer.current = window.setTimeout(() => void flush(), 64)
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
    creating,
    error,
    loadJobs,
    selectJob,
    startSample,
    startChallenge,
    cancelJob,
  }
}

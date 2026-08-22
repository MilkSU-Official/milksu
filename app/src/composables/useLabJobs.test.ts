import { afterEach, describe, expect, it } from 'vitest'
import {
  applyLabJobRecord,
  resetLabJobsForTests,
  useLabJobs,
} from './useLabJobs'

afterEach(() => {
  try {
    window.localStorage?.clear()
  } catch {
    // jsdom storage is available in this suite.
  }
  resetLabJobsForTests()
})

describe('useLabJobs', () => {
  it('renames a job and accepts an agent record patch', () => {
    const { createJob, rename, jobs } = useLabJobs()
    const job = createJob({ scope: 'local', request: '测试' })
    expect(job.title).toBe('测试')
    rename(job.id, '本地进程反病毒测试')
    expect(jobs.value[0]?.title).toBe('本地进程反病毒测试')
    applyLabJobRecord({
      id: job.id,
      title: '二次改名',
      scope: 'local',
      request: '测试',
      createdAt: job.createdAt,
      updatedAt: Date.now(),
    })
    expect(jobs.value[0]?.title).toBe('二次改名')
  })
})

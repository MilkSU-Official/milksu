import { describe, expect, it, vi } from 'vitest'
import { ref, watch } from '@/lib/reactiveStore'

describe('reactiveStore watch', () => {
  it('does not retrigger an array source when only another ref writes', () => {
    const ownerId = ref('job-1')
    const lease = ref({ state: 'none' })
    const seen: string[] = []

    watch([ownerId], ([id]) => {
      seen.push(id)
      lease.value = { state: 'none' }
    })

    ownerId.value = 'job-2'
    expect(seen).toEqual(['job-2'])
  })

  it('still fires when one entry in an array source changes', () => {
    const ownerKind = ref('lab')
    const ownerId = ref('a')
    const callback = vi.fn()
    watch([ownerKind, ownerId], callback)
    ownerId.value = 'b'
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0]).toEqual(['lab', 'b'])
  })
})

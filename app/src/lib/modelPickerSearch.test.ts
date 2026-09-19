import { describe, expect, it } from 'vitest'
import { annotateModelFailures, type SearchableModelGroup } from '@/lib/modelPickerSearch'

function groups(): SearchableModelGroup[] {
  return [
    {
      key: 'custom-relay-deepseek',
      label: 'DeepSeek',
      models: [
        { value: 'custom-relay-deepseek::deepseek-flash', label: 'deepseek-flash', model: 'deepseek-flash' },
        { value: 'custom-relay-deepseek::deepseek-v4-pro', label: 'deepseek-v4-pro', model: 'deepseek-v4-pro' },
      ],
    },
    {
      key: 'tokenflux',
      label: 'TokenFlux',
      models: [
        { value: 'tokenflux::deepseek-flash', label: 'deepseek-flash', model: 'deepseek-flash' },
      ],
    },
  ]
}

const providerOf = (group: SearchableModelGroup) => group.key

describe('annotateModelFailures', () => {
  // No record: nothing is marked, so a model that never failed is never made to look broken.
  it('leaves every model alone when there is no failure record', () => {
    for (const failures of [undefined, []]) {
      const annotated = annotateModelFailures(groups(), failures, providerOf)
      expect(annotated.flatMap(group => group.models).every(model => model.failedReason === undefined)).toBe(true)
    }
  })

  // A real failure marks exactly the model it happened to, matched on provider and model id.
  it('marks only the model that failed, and keeps the reason', () => {
    const annotated = annotateModelFailures(groups(), [{
      provider: 'custom-relay-deepseek',
      model: 'deepseek-flash',
      reason: '502 status code (no body)',
      at: '2026-09-18T09:15:00Z',
    }], providerOf)

    const marked = annotated.flatMap(group => group.models).filter(model => model.failedReason !== undefined)
    expect(marked).toHaveLength(1)
    expect(marked[0]?.value).toBe('custom-relay-deepseek::deepseek-flash')
    expect(marked[0]?.failedReason).toBe('502 status code (no body)')
    expect(marked[0]?.failedAt).toBe('2026-09-18T09:15:00Z')
    // A same-named model under another provider is untouched.
    const other = annotated[1]?.models[0]
    expect(other?.failedReason).toBeUndefined()
  })

  // Recovery: the record is gone, so the mark is gone.
  it('drops the mark once the record has been cleared', () => {
    const annotated = annotateModelFailures(groups(), [], providerOf)
    expect(annotated.flatMap(group => group.models).some(model => model.failedReason !== undefined)).toBe(false)
  })
})

// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchableModelList } from '@/components/SearchableModelPicker'
import type { SearchableModelGroup } from '@/lib/modelPickerSearch'

// The vendor icon loads an SVG through `?raw` from a symlinked node_modules, which vite refuses to
// serve outside this worktree. This test is about the failure mark, not the icon.
vi.mock('@/components/ModelVendorIcon', () => ({ default: () => null }))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function group(models: Array<{ model: string; failedReason?: string; failedAt?: string }>): SearchableModelGroup[] {
  return [{
    key: 'custom-relay-deepseek',
    label: 'DeepSeek',
    models: models.map(item => ({
      value: `custom-relay-deepseek::${item.model}`,
      label: item.model,
      model: item.model,
      failedReason: item.failedReason,
      failedAt: item.failedAt,
    })),
  }]
}

function render(groups: SearchableModelGroup[], onChange = vi.fn()) {
  act(() => {
    root.render(
      <SearchableModelList
        value="custom-relay-deepseek::deepseek-flash"
        groups={groups}
        onChange={onChange}
      />,
    )
  })
  return onChange
}

describe('model failure mark', () => {
  // The user's rule: a model that never failed must not be marked, so a working model is never
  // made to look broken.
  it('does not mark a model that never failed', () => {
    render(group([{ model: 'deepseek-flash' }]))
    expect(host.querySelectorAll('[data-testid="model-failure-mark"]')).toHaveLength(0)
  })

  // A real failure is visible, and the entry is STILL selectable: the user explicitly rejected
  // disabling it.
  it('marks a failed model but still lets the reader select it', () => {
    const onChange = render(group([{
      model: 'deepseek-flash',
      failedReason: '502 status code (no body)',
      failedAt: '2026-09-18T09:15:00Z',
    }]))

    const marks = host.querySelectorAll('[data-testid="model-failure-mark"]')
    expect(marks).toHaveLength(1)
    expect(marks[0]?.getAttribute('title') ?? '').toContain('502 status code (no body)')

    const option = host.querySelector<HTMLButtonElement>('[data-testid="model-option-custom-relay-deepseek::deepseek-flash"]')
      ?? host.querySelectorAll<HTMLButtonElement>('button')[0]!
    expect(option.disabled).toBe(false)
    act(() => option.click())
    expect(onChange).toHaveBeenCalledWith('custom-relay-deepseek::deepseek-flash')

    // The reason travels with the entry itself, so a hover explains it in place.
    expect(option.getAttribute('title') ?? '').toContain('502 status code (no body)')
  })

  // Once the model answers again the record is gone, so the red mark has to disappear.
  it('drops the mark once the model has recovered', () => {
    render(group([{ model: 'deepseek-flash' }]))
    expect(host.querySelectorAll('[data-testid="model-failure-mark"]')).toHaveLength(0)
  })
})

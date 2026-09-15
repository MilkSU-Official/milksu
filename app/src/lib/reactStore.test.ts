import { describe, expect, it, vi } from 'vitest'
import { createStore } from '@/lib/reactStore'

describe('reactStore', () => {
  it('keeps getState stable until a write', () => {
    const store = createStore({ count: 0, label: 'a' })
    const first = store.getState()
    expect(store.getState()).toBe(first)
    store.setState({ count: 1 })
    expect(store.getState()).not.toBe(first)
    expect(store.getState().count).toBe(1)
    expect(store.getState().label).toBe('a')
  })

  it('does not notify when setState writes the same fields', () => {
    const store = createStore({ count: 1, label: 'a' })
    const listener = vi.fn()
    store.subscribe(listener)
    store.setState({ count: 1 })
    store.setState(state => state)
    expect(listener).not.toHaveBeenCalled()
  })

  it('notifies subscribers after a real write', () => {
    const store = createStore({ count: 0 })
    const seen: number[] = []
    store.subscribe(() => {
      seen.push(store.getState().count)
    })
    store.setState({ count: 2 })
    expect(seen).toEqual([2])
  })
})

// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { useDossierSplit } from './useDossierSplit'

describe('useDossierSplit', () => {
  it('starts from the default width and writes the drag result', () => {
    const storage = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    })
    const split = useDossierSplit('milksu.lab-split.test', 400)
    expect(split.width.value).toBe(400)
    const handle = document.createElement('div')
    const parent = document.createElement('div')
    parent.setAttribute('data-dossier-split', '')
    Object.defineProperty(parent, 'clientWidth', { value: 1000 })
    const pane = document.createElement('div')
    pane.append(handle)
    parent.append(pane)
    document.body.append(parent)
    handle.setPointerCapture = () => undefined
    handle.releasePointerCapture = () => undefined
    split.startResize({
      preventDefault() {},
      button: 0,
      pointerId: 1,
      clientX: 100,
      currentTarget: handle,
    } as unknown as PointerEvent)
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 180 }))
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 180 }))
    expect(split.width.value).toBe(480)
    expect(storage.get('milksu.lab-split.test')).toBe('480')
    handle.remove()
  })
})

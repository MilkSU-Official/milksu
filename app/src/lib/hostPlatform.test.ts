// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyHostPlatform,
  attachWindowMaximizeDblClick,
  readHostPlatform,
  syncWindowChrome,
  toggleWindowMaximize,
} from './hostPlatform'

describe('hostPlatform', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-host-platform')
  })

  it('reads the Electron platform and defaults previews to web', () => {
    expect(readHostPlatform({})).toBe('web')
    expect(readHostPlatform({ milksu: {} })).toBe('web')
    expect(readHostPlatform({ milksu: { hostPlatform: 'win32' } })).toBe('win32')
    expect(readHostPlatform({ milksu: { hostPlatform: 'linux' } })).toBe('linux')
    expect(readHostPlatform({ milksu: { hostPlatform: 'darwin' } })).toBe('darwin')
    expect(readHostPlatform({ milksu: { hostPlatform: 'freebsd' } })).toBe('web')
  })

  it('writes data-host-platform for CSS window-chrome tokens', () => {
    applyHostPlatform(document.documentElement, 'win32')
    expect(document.documentElement.dataset.hostPlatform).toBe('win32')
  })

  it('syncs the desktop overlay without throwing when the host is missing', () => {
    const invoke = vi.fn().mockResolvedValue(true)
    syncWindowChrome('dark', { milksu: { invoke } })
    expect(invoke).toHaveBeenCalledWith('SetTitleBarOverlay', [{ theme: 'dark', mode: 'dark' }])
    syncWindowChrome('dark', { milksu: { invoke } }, 'system')
    expect(invoke).toHaveBeenCalledWith('SetTitleBarOverlay', [{ theme: 'dark', mode: 'system' }])
    expect(() => syncWindowChrome('light', {})).not.toThrow()
  })

  it('toggles native maximize only on Linux', () => {
    const invoke = vi.fn().mockResolvedValue(true)
    toggleWindowMaximize({ milksu: { hostPlatform: 'linux', invoke } })
    expect(invoke).toHaveBeenCalledWith('window.toggleMaximize', [])
    toggleWindowMaximize({ milksu: { hostPlatform: 'win32', invoke } })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(() => toggleWindowMaximize({})).not.toThrow()
  })

  it('delegates double clicks from .app-drag to toggleWindowMaximize', () => {
    const invoke = vi.fn().mockResolvedValue(true)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const cleanup = attachWindowMaximizeDblClick(window, {
      milksu: { hostPlatform: 'linux', invoke },
    })

    const dragArea = document.createElement('div')
    dragArea.className = 'app-drag'
    const button = document.createElement('button')
    button.textContent = 'Action'
    dragArea.appendChild(button)
    const noDragSpan = document.createElement('span')
    noDragSpan.className = 'app-no-drag'
    dragArea.appendChild(noDragSpan)
    const plainSpan = document.createElement('span')
    plainSpan.textContent = 'Title'
    dragArea.appendChild(plainSpan)

    container.appendChild(dragArea)

    // Double clicking plain element inside app-drag triggers maximize
    plainSpan.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(invoke).toHaveBeenCalledTimes(1)

    // Double clicking button inside app-drag does not trigger maximize
    button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(invoke).toHaveBeenCalledTimes(1)

    // Double clicking app-no-drag does not trigger maximize
    noDragSpan.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(invoke).toHaveBeenCalledTimes(1)

    cleanup()
    plainSpan.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(invoke).toHaveBeenCalledTimes(1)
    container.remove()
  })

  it('triggers toggleWindowMaximize exactly once without duplicate dispatch', () => {
    const invoke = vi.fn().mockResolvedValue(true)
    const cleanup = attachWindowMaximizeDblClick(window, {
      milksu: { hostPlatform: 'linux', invoke },
    })

    const dragRegion = document.createElement('div')
    dragRegion.className = 'window-top-drag-region app-drag'
    document.body.appendChild(dragRegion)

    dragRegion.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(invoke).toHaveBeenCalledTimes(1)

    cleanup()
    dragRegion.remove()
  })
})

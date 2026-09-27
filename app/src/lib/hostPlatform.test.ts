// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyHostPlatform, readHostPlatform, syncWindowChrome, toggleWindowMaximize } from './hostPlatform'

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
})

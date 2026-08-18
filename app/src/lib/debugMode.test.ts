// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEBUG_MODE_STORAGE_KEY,
  buildDiagnosticText,
  debugLog,
  debugLogEntries,
  isDebugMode,
  recordCacheHit,
  recordLocalHit,
  recordRpcCall,
  setDebugMode,
  updateDebugState,
} from './debugMode'

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

describe('debugMode', () => {
  beforeEach(() => {
    vi.resetModules()
    storage.clear()
    setDebugMode(false)
  })

  it('ignores logging while disabled', () => {
    debugLog('switch', 'x')
    recordRpcCall('list')
    expect(debugLogEntries()).toHaveLength(0)
  })

  it('records entries and counts only while enabled', () => {
    setDebugMode(true)
    debugLog('switch-collection', 'all -> favorites', 12)
    debugLog('search', 'local hit')
    recordLocalHit()
    recordCacheHit()
    recordRpcCall('sync_nssctf_catalog')
    updateDebugState({ view: 'favorites', selectedPlatformId: 42 })

    const entries = debugLogEntries()
    expect(entries.map(entry => entry.action)).toEqual(['switch-collection', 'search', 'rpc'])
    expect(entries[0].durationMs).toBe(12)
    expect(isDebugMode()).toBe(true)

    const text = buildDiagnosticText()
    expect(text).toContain('view: favorites')
    expect(text).toContain('local hits: 1')
    expect(text).toContain('cache hits: 1')
    expect(text).toContain('rpc calls: 1')
    expect(text).toContain('selected platform: 42')
    expect(text).toContain('switch-collection')
  })

  it('persists the enabled flag across module reloads', async () => {
    setDebugMode(true)
    expect(window.localStorage.getItem(DEBUG_MODE_STORAGE_KEY)).toBe('1')
    // reload module: flag is read back from storage on import
    const reloaded = await import('./debugMode')
    expect(reloaded.isDebugMode()).toBe(true)
  })

  it('clears logs and counters when disabled', () => {
    setDebugMode(true)
    debugLog('a')
    recordLocalHit()
    setDebugMode(false)
    expect(debugLogEntries()).toHaveLength(0)
    expect(buildDiagnosticText()).toContain('local hits: 0')
  })
})

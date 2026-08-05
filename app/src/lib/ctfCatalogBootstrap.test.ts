import { describe, expect, it } from 'vitest'
import { shouldBootstrapNSSCTFCatalog } from './ctfCatalogBootstrap'

describe('NSSCTF catalog bootstrap', () => {
  it('starts exactly once for a clean NSSCTF catalog', () => {
    expect(shouldBootstrapNSSCTFCatalog({
      activeBank: 'nssctf',
      catalogTotal: 0,
      syncing: false,
      attempted: false,
    })).toBe(true)
  })

  it('does not repeat or run for another platform', () => {
    expect(shouldBootstrapNSSCTFCatalog({
      activeBank: 'nssctf',
      catalogTotal: 0,
      syncing: false,
      attempted: true,
    })).toBe(false)
    expect(shouldBootstrapNSSCTFCatalog({
      activeBank: 'ctfshow',
      catalogTotal: 0,
      syncing: false,
      attempted: false,
    })).toBe(false)
  })

  it('keeps an existing catalog and active sync untouched', () => {
    expect(shouldBootstrapNSSCTFCatalog({
      activeBank: 'nssctf',
      catalogTotal: 42,
      syncing: false,
      attempted: false,
    })).toBe(false)
    expect(shouldBootstrapNSSCTFCatalog({
      activeBank: 'nssctf',
      catalogTotal: 0,
      syncing: true,
      attempted: false,
    })).toBe(false)
  })
})

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ALL_COLLECTIONS_ID, createItemCollectionStore, QUICK_COLLECTION_ID } from './itemCollections'

const storage = new Map<string, string>()

Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
  configurable: true,
})

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('crypto', { randomUUID: () => 'fixed-id' })
})

describe('item collections', () => {
  it('keeps one item in several collections and persists the aggregate view', () => {
    const store = createItemCollectionStore('test.collections')

    store.toggle('nssctf:3347')
    const reverse = store.create('逆向练习', 'nssctf:3347')
    store.create('Web 专项', 'nssctf:1024')

    expect(store.collectionIdsFor('nssctf:3347')).toEqual([QUICK_COLLECTION_ID, reverse])
    expect(store.itemKeysFor(ALL_COLLECTIONS_ID)).toEqual(['nssctf:3347', 'nssctf:1024'])
    expect(store.uniqueItemCount.value).toBe(2)

    const reloaded = createItemCollectionStore('test.collections')
    expect(reloaded.has('nssctf:3347', reverse)).toBe(true)
    expect(reloaded.collections.value.map(item => item.name)).toEqual(['收藏', '逆向练习', 'Web 专项'])
  })

  it('removes custom folders without removing the built-in quick collection', () => {
    const store = createItemCollectionStore('test.collections')
    const custom = store.create('稍后挑战', 'ctfshow:12')

    store.remove(custom)
    store.remove(QUICK_COLLECTION_ID)

    expect(store.collections.value).toHaveLength(1)
    expect(store.collections.value[0].id).toBe(QUICK_COLLECTION_ID)
  })

  it('rejects empty and duplicate names', () => {
    const store = createItemCollectionStore('test.collections')
    store.create('Web 专项')

    expect(() => store.create('  ')).toThrow('请输入收藏夹名称')
    expect(() => store.create('web 专项')).toThrow('已经有同名收藏夹')
  })
})

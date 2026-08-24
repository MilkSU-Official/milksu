import { computed, ref, type Ref } from 'vue'
import { t } from '@/lib/uiLocale'

export const QUICK_COLLECTION_ID = 'favorites'
export const ALL_COLLECTIONS_ID = 'all'

export interface ItemCollection {
  id: string
  name: string
  itemKeys: string[]
  createdAt: string
}

interface PersistedItemCollections {
  schema: 1
  collections: ItemCollection[]
}

export interface ItemCollectionStore {
  collections: Readonly<Ref<ItemCollection[]>>
  revision: Readonly<Ref<number>>
  uniqueItemCount: Readonly<Ref<number>>
  itemKeysFor: (collectionId?: string) => string[]
  collectionIdsFor: (itemKey: string) => string[]
  has: (itemKey: string, collectionId?: string) => boolean
  toggle: (itemKey: string, collectionId?: string) => void
  create: (name: string, itemKey?: string) => string
  remove: (collectionId: string) => void
}

function defaultCollection(): ItemCollection {
  return {
    id: QUICK_COLLECTION_ID,
    name: t('收藏', 'Favorites'),
    itemKeys: [],
    createdAt: new Date(0).toISOString(),
  }
}

function normalizeCollection(value: unknown): ItemCollection | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ItemCollection>
  const id = String(raw.id ?? '').trim()
  const name = String(raw.name ?? '').trim()
  if (!id || !name) return null
  return {
    id,
    name: name.slice(0, 30),
    itemKeys: [...new Set((Array.isArray(raw.itemKeys) ? raw.itemKeys : [])
      .map(item => String(item).trim())
      .filter(Boolean))],
    createdAt: String(raw.createdAt ?? '').trim() || new Date().toISOString(),
  }
}

function readCollections(storageKey: string): ItemCollection[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '') as Partial<PersistedItemCollections>
    if (parsed.schema !== 1 || !Array.isArray(parsed.collections)) throw new Error('unsupported schema')
    const normalized = parsed.collections
      .map(normalizeCollection)
      .filter((item): item is ItemCollection => Boolean(item))
    const quick = normalized.find(item => item.id === QUICK_COLLECTION_ID)
    return [quick ?? defaultCollection(), ...normalized.filter(item => item.id !== QUICK_COLLECTION_ID)]
  } catch {
    return [defaultCollection()]
  }
}

function createCollectionId() {
  const generated = globalThis.crypto?.randomUUID?.()
  return generated ? `collection-${generated}` : `collection-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createItemCollectionStore(storageKey: string): ItemCollectionStore {
  const collections = ref(readCollections(storageKey))
  const revision = ref(0)

  function persist() {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({
        schema: 1,
        collections: collections.value,
      } satisfies PersistedItemCollections))
    } catch {
      // A disabled storage backend should not make the list unusable for this session.
    }
    revision.value += 1
  }

  function itemKeysFor(collectionId = ALL_COLLECTIONS_ID) {
    if (collectionId === ALL_COLLECTIONS_ID) {
      return [...new Set(collections.value.flatMap(collection => collection.itemKeys))]
    }
    return [...(collections.value.find(collection => collection.id === collectionId)?.itemKeys ?? [])]
  }

  function collectionIdsFor(itemKey: string) {
    return collections.value
      .filter(collection => collection.itemKeys.includes(itemKey))
      .map(collection => collection.id)
  }

  function has(itemKey: string, collectionId = ALL_COLLECTIONS_ID) {
    return itemKeysFor(collectionId).includes(itemKey)
  }

  function toggle(itemKey: string, collectionId = QUICK_COLLECTION_ID) {
    const key = itemKey.trim()
    const collection = collections.value.find(item => item.id === collectionId)
    if (!key || !collection) return
    collection.itemKeys = collection.itemKeys.includes(key)
      ? collection.itemKeys.filter(item => item !== key)
      : [...collection.itemKeys, key]
    persist()
  }

  function create(name: string, itemKey?: string) {
    const normalized = name.trim().replace(/\s+/g, ' ').slice(0, 30)
    if (!normalized) throw new Error(t('请输入收藏夹名称', 'Enter a collection name'))
    if (collections.value.some(collection => collection.name.toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
      throw new Error(t('已经有同名收藏夹', 'A collection with this name already exists'))
    }
    const id = createCollectionId()
    collections.value.push({
      id,
      name: normalized,
      itemKeys: itemKey?.trim() ? [itemKey.trim()] : [],
      createdAt: new Date().toISOString(),
    })
    persist()
    return id
  }

  function remove(collectionId: string) {
    if (collectionId === QUICK_COLLECTION_ID) return
    const next = collections.value.filter(collection => collection.id !== collectionId)
    if (next.length === collections.value.length) return
    collections.value = next
    persist()
  }

  return {
    collections: computed(() => collections.value),
    revision: computed(() => revision.value),
    uniqueItemCount: computed(() => itemKeysFor().length),
    itemKeysFor,
    collectionIdsFor,
    has,
    toggle,
    create,
    remove,
  }
}

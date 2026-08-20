// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_VIEW_STATE_STORAGE_KEY,
  readWorkspaceViewState,
  writeWorkspaceViewState,
  type WorkspaceViewState,
} from './workspaceViewState'

describe('workspaceViewState', () => {
  it('round trips the last visible workspace and conversation', () => {
    const storage = createMemoryStorage()
    const state: WorkspaceViewState = {
      version: 1,
      section: 'chat',
      activeConversationId: 'conversation-1',
      codingHistoryOpen: false,
      ctfSection: 'catalog',
      settingsCategory: 'chats',
      settingsReturnTarget: 'chat',
    }

    writeWorkspaceViewState(state, storage)

    expect(readWorkspaceViewState(storage)).toEqual(state)
  })

  it('rejects malformed state and normalizes optional view fields', () => {
    const storage = createMemoryStorage()
    storage.setItem(WORKSPACE_VIEW_STATE_STORAGE_KEY, '{broken')
    expect(readWorkspaceViewState(storage)).toBeNull()

    storage.setItem(WORKSPACE_VIEW_STATE_STORAGE_KEY, JSON.stringify({
      version: 1,
      section: 'chat',
      activeConversationId: 123,
      codingHistoryOpen: 'yes',
      ctfSection: 'missing',
      settingsCategory: 'missing',
      settingsReturnTarget: 'settings',
    }))
    expect(readWorkspaceViewState(storage)).toMatchObject({
      activeConversationId: null,
      codingHistoryOpen: true,
      ctfSection: 'catalog',
      settingsCategory: 'general',
      settingsReturnTarget: 'ctf',
    })
  })
})

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear() { values.clear() },
    getItem(key) { return values.get(key) ?? null },
    key(index) { return Array.from(values.keys())[index] ?? null },
    removeItem(key) { values.delete(key) },
    setItem(key, value) { values.set(key, value) },
  }
}

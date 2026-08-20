// @vitest-environment jsdom

import { createApp, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ArchivedConversationsSettings from './ArchivedConversationsSettings.vue'

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

afterEach(() => {
  document.body.innerHTML = ''
  Reflect.deleteProperty(window, 'milksu')
})

describe('ArchivedConversationsSettings', () => {
  it('requires confirmation before restoring or permanently deleting', async () => {
    const restore = vi.fn(async (_id: unknown) => undefined)
    const remove = vi.fn(async (_id: unknown) => undefined)
    let archived = [{
      id: 'archived-1',
      title: '归档测试会话',
      createdAt: 1,
      archivedAt: Date.now(),
      messages: [],
    }]
    Object.defineProperty(window, 'milksu', {
      configurable: true,
      value: {
        invoke(method: string, args: unknown[]) {
          if (method === 'ListArchivedConversations') return Promise.resolve(archived)
          if (method === 'RestoreConversation') {
            archived = []
            return restore(args[0])
          }
          if (method === 'DeleteArchivedConversation') {
            archived = []
            return remove(args[0])
          }
          throw new Error(`unexpected method ${method}`)
        },
        onEvent: () => () => {},
      },
    })
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(ArchivedConversationsSettings)
    app.mount(host)
    await settle()

    const restoreButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '恢复')
    restoreButton?.click()
    await settle()
    expect(restore).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('恢复聊天？')

    const confirmRestore = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '确认恢复')
    confirmRestore?.click()
    await settle()
    expect(restore).toHaveBeenCalledOnce()

    archived = [{ id: 'archived-2', title: '永久删除测试', createdAt: 2, archivedAt: Date.now(), messages: [] }]
    app.unmount()
    const second = createApp(ArchivedConversationsSettings)
    second.mount(host)
    await settle()
    const deleteButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '删除')
    deleteButton?.click()
    await settle()
    expect(remove).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('永久删除聊天？')
    second.unmount()
  })
})

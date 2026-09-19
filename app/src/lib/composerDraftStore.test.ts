// @vitest-environment jsdom

// 用户两次因"切对话丢草稿"重打大段文字。这里锁住四件事：
// 落盘、切 key 往返不丢、发送后清空、空内容不残留。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'milksu.composer-drafts.v1'

/**
 * 这个仓库的 vitest 环境不一定提供 localStorage，而"草稿是否真的落盘"正是要验的东西，
 * 所以测试自己装一个内存实现（挂在 globalThis/window 上，跨 resetModules 仍然存在，
 * 正好模拟应用重启后重新读取）。
 */
function installStorageStub(): Storage {
  const target = (globalThis as unknown as { window?: unknown }).window ?? globalThis
  const host = target as Record<string, unknown> & { localStorage?: Storage }
  if (!host.localStorage) {
    const map = new Map<string, string>()
    const stub: Storage = {
      get length() { return map.size },
      clear: () => { map.clear() },
      getItem: key => (map.has(String(key)) ? map.get(String(key))! : null),
      key: index => [...map.keys()][index] ?? null,
      removeItem: key => { map.delete(String(key)) },
      setItem: (key, value) => { map.set(String(key), String(value)) },
    }
    Object.defineProperty(host, 'localStorage', { configurable: true, value: stub })
  }
  return host.localStorage as Storage
}

async function freshStore() {
  vi.resetModules()
  return import('@/lib/composerDraftStore')
}

describe('composer draft store', () => {
  beforeEach(() => {
    installStorageStub().clear()
    vi.resetModules()
  })

  it('keeps a draft for its own conversation and returns it when switching back', async () => {
    const store = await freshStore()
    store.writeComposerDraft('conversation-a', { html: '', text: 'REPRO草稿测试-XYZZY', attachments: [] })
    store.writeComposerDraft('conversation-b', { html: '', text: 'B 的内容', attachments: [] })

    expect(store.readComposerDraft('conversation-b')?.text).toBe('B 的内容')
    expect(store.readComposerDraft('conversation-a')?.text).toBe('REPRO草稿测试-XYZZY')
  })

  it('survives a restart because the draft is written to storage', async () => {
    const first = await freshStore()
    first.writeComposerDraft('conversation-a', { html: '', text: '崩溃前的草稿', attachments: [] })
    expect(installStorageStub().getItem(STORAGE_KEY)).toContain('崩溃前的草稿')

    // 重新加载模块 = 应用重启（内存 Map 清空），草稿应从落盘内容恢复。
    const second = await freshStore()
    expect(second.readComposerDraft('conversation-a')?.text).toBe('崩溃前的草稿')
  })

  it('clears the draft after a successful send', async () => {
    const store = await freshStore()
    store.writeComposerDraft('conversation-a', { html: '', text: '已经发出去了', attachments: [] })
    store.clearComposerDraft('conversation-a')

    expect(store.readComposerDraft('conversation-a')).toBeUndefined()
    expect(installStorageStub().getItem(STORAGE_KEY) ?? '').not.toContain('已经发出去了')
  })

  // 行为在 2026-09-18 有意改变：空写不再删除草稿。
  // 切换对话等路径会在切走时顺手写一次空内容，若沿用"空即删除"的旧规则，
  // 读者的草稿就会在切走的一瞬间被抹掉（已真机复现并抓到调用栈）。
  // 现在只有显式 clearComposerDraft 才会移除草稿。
  // The exact switch-away sequence that lost drafts in the shipped composer: the editor was already
  // emptied when the conversation changed, and that emptied content was written back under the
  // *previous* conversation's key. Writing emptiness must never be what removes a draft.
  it('keeps the previous conversation draft through the switch-away write', async () => {
    const store = await freshStore()
    store.writeComposerDraft('conversation-previous', {
      html: '<p>还没发的内容</p>',
      text: '还没发的内容',
      attachments: [],
    })
    // What the old composer did on switch: persist whatever the editor held, which was empty.
    store.writeComposerDraft('conversation-previous', { html: '', text: '', attachments: [] })

    expect(store.readComposerDraft('conversation-previous')?.text).toBe('还没发的内容')

    // The conversation switched to keeps its own draft, and the other one is untouched.
    store.writeComposerDraft('conversation-next', {
      html: '<p>下一个会话的内容</p>',
      text: '下一个会话的内容',
      attachments: [],
    })
    expect(store.readComposerDraft('conversation-next')?.text).toBe('下一个会话的内容')
    expect(store.readComposerDraft('conversation-previous')?.text).toBe('还没发的内容')

    // Only an explicit clear removes it.
    store.clearComposerDraft('conversation-previous')
    expect(store.readComposerDraft('conversation-previous')).toBeUndefined()
  })

  // 非空的写入也会丢文字：它带着附件，所以不是"空写"，会直接把文字更多的旧草稿覆盖掉。
  // 这是真机残留缺陷的确切形态（附件留下、文字永久消失，且与先附件还是先文字无关）。
  it('never lets an attachment-only write wipe the text already stored for that key', async () => {
    const store = await freshStore()
    store.writeComposerDraft('conversation-a', {
      html: '<p>已经打好的文字</p>',
      text: '已经打好的文字',
      attachments: [],
    })
    // 切走那一刻：编辑器是空的，附件来自另一处状态。
    store.writeComposerDraft('conversation-a', {
      html: '',
      text: '',
      attachments: [{ id: 'a1', name: '图.png', mediaType: 'image/png', size: 1, sha256: 'x' }],
    })

    const restored = store.readComposerDraft('conversation-a')
    expect(restored?.text).toBe('已经打好的文字')
    expect(restored?.attachments).toHaveLength(1)
  })

  // 附件 + 文字：切走再回来，两者都必须还在（用户报的那一步）。
  it('keeps both the text and the attachments across a switch away and back', async () => {
    const store = await freshStore()
    const attachment = { id: 'a1', name: '材料.pdf', mediaType: 'application/pdf', size: 2, sha256: 'y' }
    store.writeComposerDraft('conversation-a', {
      html: '<p>帮我看这份材料</p>',
      text: '帮我看这份材料',
      attachments: [attachment],
    })
    // 切走：先恢复成空（旧代码会把这份混合快照写回）
    store.writeComposerDraft('conversation-a', { html: '', text: '', attachments: [attachment] })
    store.writeComposerDraft('conversation-b', { html: '', text: '另一个会话', attachments: [] })
    // 切回来
    const restored = store.readComposerDraft('conversation-a')
    expect(restored?.text).toBe('帮我看这份材料')
    expect(restored?.attachments).toEqual([attachment])
    // 另一个会话不受影响
    expect(store.readComposerDraft('conversation-b')?.text).toBe('另一个会话')
  })

  it('keeps the draft when an empty write arrives, and only an explicit clear removes it', async () => {
    const store = await freshStore()
    store.writeComposerDraft('conversation-a', { html: '', text: '打了一半', attachments: [] })
    store.writeComposerDraft('conversation-a', { html: '', text: '   ', attachments: [] })

    expect(store.readComposerDraft('conversation-a')?.text).toBe('打了一半')

    store.clearComposerDraft('conversation-a')
    expect(store.readComposerDraft('conversation-a')).toBeUndefined()
  })
})

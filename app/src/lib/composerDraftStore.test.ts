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

describe('an explicit clear really clears the stored draft', () => {
  // 真机 beta.50：读者点掉最后一个附件之后，存储里还留着旧值，重启又回来了。
  // 因为"空写不删"这条保护把"用户主动删除"也一起挡了。
  it('removes the key for an explicit clear, but keeps protecting an accidental one', async () => {
    const store = await freshStore()
    const key = 'conversation-explicit'
    store.writeComposerDraft(key, { html: '', text: '昨天写的话', attachments: [] })
    store.flushComposerDraftsNow()
    expect(store.readComposerDraft(key)?.text).toBe('昨天写的话')

    // ① 意外空写（切换对话/卸载）：旧值必须留着
    store.writeComposerDraft(key, { html: '', text: '', attachments: [] })
    expect(store.readComposerDraft(key)?.text).toBe('昨天写的话')

    // ② 用户主动删除：合并后由调用方（作曲栏）走 clearComposerDraft ⇒ 立刻落盘，这一格要消失
    store.clearComposerDraft(key)
    expect(store.readComposerDraft(key)).toBeUndefined()
    expect(installStorageStub().getItem(STORAGE_KEY) ?? '').not.toContain('昨天写的话')

    // 重新 hydrate（= 重启）也不能把它找回来
    const restarted = await freshStore()
    expect(restarted.readComposerDraft(key)).toBeUndefined()
  })

  // 用户场景：附件 + 文字 → 显式删除 → 重启后都不在。
  it('does not resurrect a deleted attachment after a restart', async () => {
    const store = await freshStore()
    const key = 'conversation-attach'
    const attachment = { id: 'a1', name: 'image.png', mediaType: 'image/png', size: 1, sha256: 'z' }
    store.writeComposerDraft(key, { html: '', text: '', attachments: [attachment] })
    store.flushComposerDraftsNow()
    expect(store.readComposerDraft(key)?.attachments).toHaveLength(1)

    // 读者点掉了最后一个附件 ⇒ 显式删除。这里断言**存储本身**不再含旧正文/旧附件名，
    // 而不只是看 store 的读接口（只看读接口的话，修前也会"通过"，等于没锁住）。
    store.writeComposerDraft(key, { html: '', text: '昨天的正文', attachments: [attachment] })
    store.flushComposerDraftsNow()
    store.clearComposerDraft(key)

    const raw = installStorageStub().getItem(STORAGE_KEY) ?? ''
    expect(raw).not.toContain('昨天的正文')
    expect(raw).not.toContain('image.png')

    const restarted = await freshStore()
    expect(restarted.readComposerDraft(key)).toBeUndefined()
  })

  it('keeps the previous conversation draft through the switch-away write', async () => {
    const store = await freshStore()
    store.writeComposerDraft('conversation-previous', {
      html: '<p>还没发的内容</p>',
      text: '还没发的内容',
      attachments: [],
    })
    // 旧作曲栏在切换时会把手里的编辑器状态写一次，而那一刻编辑器是空的。
    store.writeComposerDraft('conversation-previous', { html: '', text: '', attachments: [] })
    expect(store.readComposerDraft('conversation-previous')?.text).toBe('还没发的内容')

    store.writeComposerDraft('conversation-next', {
      html: '<p>下一个会话的内容</p>',
      text: '下一个会话的内容',
      attachments: [],
    })
    expect(store.readComposerDraft('conversation-next')?.text).toBe('下一个会话的内容')
    expect(store.readComposerDraft('conversation-previous')?.text).toBe('还没发的内容')

    // 只有显式清空才会移除。
    store.clearComposerDraft('conversation-previous')
    expect(store.readComposerDraft('conversation-previous')).toBeUndefined()
  })
})

describe('clearing the body covers the same intent', () => {
  // 装机线的输入回调在"读者把正文删空且没有附件"时走 clearComposerDraft（显式清空）。
  // 这里锁住那条路的本意：键消失、且落盘，重启不再冒出来。
  it('removes the key when the body is cleared', async () => {
    const store = await freshStore()
    const key = 'conversation-body-cleared'
    store.writeComposerDraft(key, { html: '', text: '打了一半又删掉', attachments: [] })
    store.flushComposerDraftsNow()
    expect(store.readComposerDraft(key)?.text).toBe('打了一半又删掉')

    store.clearComposerDraft(key)
    store.flushComposerDraftsNow()
    expect(installStorageStub().getItem(STORAGE_KEY) ?? '').not.toContain('打了一半又删掉')
    const restarted = await freshStore()
    expect(restarted.readComposerDraft(key)).toBeUndefined()
  })

  // 同时锁住反面：切换会话造成的空写，旧值必须仍在。
  it('still keeps the old value for an empty write that is not a deletion', async () => {
    const store = await freshStore()
    const key = 'conversation-switched-away'
    store.writeComposerDraft(key, { html: '', text: '切走前的正文', attachments: [] })
    store.flushComposerDraftsNow()
    store.writeComposerDraft(key, { html: '', text: '', attachments: [] })
    store.flushComposerDraftsNow()
    expect(store.readComposerDraft(key)?.text).toBe('切走前的正文')
  })
})

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
    // 落盘现在是防抖的（避免每次按键都写盘）：要"立刻落盘"的测试自己显式喊一次。
    first.flushComposerDraftsNow()
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
  it('keeps at most 50 conversations and drops the least recently used ones', async () => {
    const store = await freshStore()
    for (let index = 0; index < 55; index += 1) {
      store.writeComposerDraft(`conversation-${index}`, {
        html: '',
        text: `第 ${index} 条`,
        attachments: [],
      })
    }
    // 淘汰发生在落盘时（写入现在是防抖的），所以先显式落一次盘。
    store.flushComposerDraftsNow()
    // 最早写的那些应先被淘汰，最近写的必须还在
    expect(store.readComposerDraft('conversation-0')).toBeUndefined()
    expect(store.readComposerDraft('conversation-4')).toBeUndefined()
    expect(store.readComposerDraft('conversation-54')?.text).toBe('第 54 条')
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

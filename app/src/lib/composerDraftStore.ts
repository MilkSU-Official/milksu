import type { CodingAttachment } from '@/types'
import type { WorkspaceHome } from '@/lib/workspaceSessionRouting'

export type StoredComposerDraft = {
  html: string
  text: string
  attachments: CodingAttachment[]
  /** 最近一次写入时间：用于超出上限时淘汰最久未用的那一格。旧存档没有这个字段。 */
  at?: number
}

/**
 * 草稿必须活过"切换对话"，也必须活过"重启/崩溃"。
 *
 * 它原来只存在这个模块级 Map 里（纯内存）：切对话时靠"保存上一份"那一步兜，
 * 而走的是比较基准的时序——一旦基准已经变成新会话，那一格就再也写不进去，
 * 用户切回去就发现白打了一大段（用户已经因此损失两次输入）。
 * 现在 Map 仍是读缓存，但每次写入都落盘（localStorage），启动时自动恢复。
 */
const drafts = new Map<string, StoredComposerDraft>()
// 写入次序：时间戳可能相同（同一毫秒内连续写），单靠时间戳淘汰顺序不确定。
// 同一时间戳下，后写的算"更新"，先写的老格子先被淘汰。
const draftOrder = new Map<string, number>()
let draftSeq = 0

const STORAGE_KEY = 'milksu.composer-drafts.v1'
// 上限：避免长期使用后无限增长（读者的担心）。超出就丢最久没用过的会话格子，
// 保留正在用的。体积上限同时兜住"某个会话里粘了超长文本"的情况。
const MAX_DRAFT_ENTRIES = 50
const MAX_DRAFT_BYTES = 256 * 1024

// 每次按键都同步落盘会让输入卡顿：一次写入要序列化整张表并写一次 localStorage，agent
// 流式输出时界面频繁重绘、主线程被占，更明显（真机实测：十几个字打了 980 次写盘）。
// 所以内存**立刻**更新（见 write/clear），而落盘按下面这个窗口合并；不能等的时机
// （清空、发送、切换会话、失焦、卸载）直接调 flushComposerDraftsNow。
const FLUSH_DEBOUNCE_MS = 200
// 一直打字也不能永远不落盘：超过这个时间必须写一次。
const FLUSH_MAX_WAIT_MS = 1000
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushDeadline = 0

/** 立刻落盘：给“不能等”的时机用（清空、发送、切换会话、失焦、卸载、pagehide）。 */
export function flushComposerDraftsNow() {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  flushDeadline = 0
  persist()
}

function scheduleFlush() {
  const now = Date.now()
  if (flushDeadline === 0) flushDeadline = now + FLUSH_MAX_WAIT_MS
  if (flushTimer !== null) clearTimeout(flushTimer)
  const wait = Math.max(0, Math.min(FLUSH_DEBOUNCE_MS, flushDeadline - now))
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushDeadline = 0
    persist()
  }, wait)
}

/**
 * 内容签名：只认“内容”本身，不认对象引用。
 *
 * 组件那条 effect 会在每次重绘时跑（依赖里有每次新建的值），真机实测草稿表被打点写了
 * 980 次（用户只打了十几个字）。所以写入前比较签名：内容没变就既不写内存、也不排落盘。
 */
function draftSignature(draft: {
  html: string
  text: string
  attachments: readonly { id?: string; name?: string }[]
}) {
  const attachments = draft.attachments
    .map(entry => `${String(entry?.id ?? '')}:${String(entry?.name ?? '')}`)
    .join(',')
  return `${draft.text}\u0000${draft.html}\u0000${attachments}`
}

const lastSignature = new Map<string, string>()
const draftListeners = new Set<() => void>()

function notifyComposerDrafts() {
  for (const listener of draftListeners) listener()
}

export function subscribeComposerDrafts(listener: () => void) {
  draftListeners.add(listener)
  return () => {
    draftListeners.delete(listener)
  }
}

export function composerDraftPending(conversationId?: string | null) {
  const draft = drafts.get(String(conversationId ?? '').trim())
  if (!draft) return false
  if (String(draft.text ?? '').trim()) return true
  if (draft.attachments.length > 0) return true
  return !isBlankComposerMarkup(draft.html)
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage ?? null
  } catch {
    // 隐私模式等场景下访问 localStorage 会抛异常：草稿退化成纯内存，不影响打字本身。
    return null
  }
}

function isStoredDraft(value: unknown): value is StoredComposerDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<StoredComposerDraft>
  return typeof draft.html === 'string' && typeof draft.text === 'string'
}

function hydrate() {
  const store = storage()
  if (!store) return
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!key || !isStoredDraft(value)) continue
      draftOrder.set(key, ++draftSeq)
      drafts.set(key, {
        html: value.html,
        text: value.text,
        attachments: Array.isArray(value.attachments) ? [...value.attachments] : [],
        at: Number.isFinite(value.at) ? Number(value.at) : 0,
      })
    }
  } catch {
    // 落盘内容坏了就当没有草稿：宁可空着，也不要让启动卡在这里。
  }
}

function prune() {
  if (drafts.size <= MAX_DRAFT_ENTRIES) {
    const bytes = JSON.stringify(Object.fromEntries(drafts)).length
    if (bytes <= MAX_DRAFT_BYTES) return
  }
  // 按最近使用时间从新到旧保留，先满足条数上限，再满足体积上限。
  const ordered = [...drafts.entries()].sort((a, b) => {
    const byTime = (b[1].at ?? 0) - (a[1].at ?? 0)
    if (byTime !== 0) return byTime
    return (draftOrder.get(b[0]) ?? 0) - (draftOrder.get(a[0]) ?? 0)
  })
  const kept = new Map<string, StoredComposerDraft>()
  let bytes = 2
  for (const [key, value] of ordered) {
    if (kept.size >= MAX_DRAFT_ENTRIES) break
    const size = JSON.stringify(value).length + key.length + 4
    if (kept.size > 0 && bytes + size > MAX_DRAFT_BYTES) break
    kept.set(key, value)
    bytes += size
  }
  drafts.clear()
  for (const [key, value] of kept) drafts.set(key, value)
}

function persist() {
  const store = storage()
  if (!store) return
  try {
    prune()
    if (!drafts.size) {
      store.removeItem(STORAGE_KEY)
      return
    }
    store.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(drafts)))
  } catch {
    // 配额满等情况：内存里的草稿仍然可用，不因为落盘失败影响打字。
  }
}

hydrate()

export function composerDraftKey(
  conversationId?: string | null,
  workspaceHome: WorkspaceHome = 'chat',
) {
  const id = String(conversationId ?? '').trim()
  return id || `pending:${workspaceHome}`
}

export function readComposerDraft(key: string): StoredComposerDraft | undefined {
  const normalized = String(key ?? '').trim()
  if (!normalized) return undefined
  const stored = drafts.get(normalized)
  if (!stored) return undefined
  return {
    html: stored.html,
    text: stored.text,
    attachments: [...stored.attachments],
  }
}

/**
 * 编辑器里只剩空行（<br>、空 div、空白、&nbsp;）时，读者看到的是空输入框，
 * 因此必须按"空"处理：既不能让"清空输入框"留下一格空壳，也不能把空壳当成内容。
 */
export function isBlankComposerMarkup(html: string): boolean {
  return !String(html ?? '').replace(/<br\s*\/?>|<div>\s*<\/div>|&nbsp;|\s/gi, '').trim()
}

export function writeComposerDraft(key: string, draft: StoredComposerDraft) {
  const normalized = String(key ?? '').trim()
  if (!normalized) return
  let html = String(draft.html ?? '')
  let text = String(draft.text ?? '')
  const attachments = [...(draft.attachments ?? [])]
  if (isBlankComposerMarkup(html) && !text.trim() && !attachments.length) {
    // 空写不再删除草稿：切换对话等路径会顺手写一次空内容，若沿用"空即删除"
    // 的旧规则，读者的草稿就会在切走的一瞬间被抹掉（已真机复现并抓到调用栈）。
    // 真正要清空时请显式调用 clearComposerDraft。
    return
  }
  const stored = drafts.get(normalized)
  if (stored && !text.trim() && attachments.length) {
    // 带附件但没有文字的写入，不得抹掉同一格里已有的文字。
    //
    // "空写不删"挡不住这一种：它带着附件，所以不是空写，会走到下面的 set，于是把文字
    // 更多的旧草稿整个覆盖掉。真机现象正是"附件留下、文字永久消失"（先附件后文字、
    // 先文字后附件都会发生），因为切走那一刻编辑器可能是空的，而附件来自另一处状态。
    // 真正要清空请显式调用 clearComposerDraft（发送后就是走那条路）。
    const storedText = String(stored.text ?? '')
    if (storedText.trim()) {
      text = storedText
      if (isBlankComposerMarkup(html)) html = String(stored.html ?? '')
    }
  }
  const signature = draftSignature({ html, text, attachments })
  if (lastSignature.get(normalized) === signature) {
    // 内容一模一样：这一次是界面重绘，不是编辑。不写内存、不排落盘。
    return
  }
  lastSignature.set(normalized, signature)
  drafts.set(normalized, { html, text, attachments, at: Date.now() })
  draftOrder.set(normalized, ++draftSeq)
  scheduleFlush()
  notifyComposerDrafts()
}

export function clearComposerDraft(key: string) {
  const normalized = String(key ?? '').trim()
  if (!normalized) return
  drafts.delete(normalized)
  draftOrder.delete(normalized)
  lastSignature.delete(normalized)
  // 清空是“不能等”的意图（发送后、用户主动删掉最后一格）：立刻落盘，
  // 否则重启后旧草稿会从存储里复活。
  flushComposerDraftsNow()
  notifyComposerDrafts()
}

export function resetComposerDrafts() {
  drafts.clear()
  lastSignature.clear()
  flushComposerDraftsNow()
  notifyComposerDrafts()
}

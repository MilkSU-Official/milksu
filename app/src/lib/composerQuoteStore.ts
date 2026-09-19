/**
 * Quotes are kept per conversation, keyed exactly like the composer draft, so switching to another
 * conversation and back does not lose what the reader had selected. Same lifetime as the draft:
 * persisted to local storage (like the draft), cleared once the message is sent.
 */
import type { ComposerQuote } from '@/lib/composerQuote'

const quotesByKey = new Map<string, ComposerQuote[]>()
// 每格的最近使用时间（仅内存，用于淘汰顺序；不必落盘）
const quoteAt = new Map<string, number>()
// 与草稿同理：时间戳相同时用写入次序保证淘汰顺序确定。
const quoteOrder = new Map<string, number>()
let quoteSeq = 0
const STORAGE_KEY = 'milksu.composer-quotes.v1'
// 与草稿同一套上限策略：超出丢最久未用的会话格子，避免无限增长。
const MAX_QUOTE_ENTRIES = 50
const MAX_QUOTE_BYTES = 128 * 1024

function normalize(key: string) {
  return String(key ?? '').trim()
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage ?? null
  } catch {
    // 隐私模式等场景访问 localStorage 会抛异常：退化成纯内存，不影响使用。
    return null
  }
}

function pruneQuotes() {
  const ordered = [...quotesByKey.entries()].sort((a, b) => {
    const byTime = (quoteAt.get(b[0]) ?? 0) - (quoteAt.get(a[0]) ?? 0)
    if (byTime !== 0) return byTime
    return (quoteOrder.get(b[0]) ?? 0) - (quoteOrder.get(a[0]) ?? 0)
  })
  const kept = new Map<string, ComposerQuote[]>()
  let bytes = 2
  for (const [key, value] of ordered) {
    if (kept.size >= MAX_QUOTE_ENTRIES) break
    const size = JSON.stringify(value).length + key.length + 4
    if (kept.size > 0 && bytes + size > MAX_QUOTE_BYTES) break
    kept.set(key, value)
    bytes += size
  }
  quotesByKey.clear()
  for (const [key, value] of kept) quotesByKey.set(key, value)
}

function flush() {
  const store = storage()
  if (!store) return
  try {
    pruneQuotes()
    if (!quotesByKey.size) {
      store.removeItem(STORAGE_KEY)
      return
    }
    store.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(quotesByKey)))
  } catch {
    // 配额满等情况：内存里的引用仍然可用。
  }
}

function hydrate() {
  const store = storage()
  if (!store) return
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, ComposerQuote[]>
    for (const [key, value] of Object.entries(parsed ?? {})) {
      if (!Array.isArray(value)) continue
      const usable = value.filter(
        quote => String(quote?.id ?? '').trim() && String(quote?.text ?? '').trim(),
      )
      if (usable.length) {
        quotesByKey.set(key, usable)
        quoteOrder.set(key, ++quoteSeq)
      }
    }
  } catch {
    // 损坏的存档不影响启动：当作没有引用。
  }
}

hydrate()

export function readComposerQuotes(key: string): ComposerQuote[] | undefined {
  const stored = quotesByKey.get(normalize(key))
  if (!stored) return undefined
  // Hand out copies so a caller cannot mutate the stored list in place.
  return stored.map(quote => ({ ...quote }))
}

export function writeComposerQuotes(key: string, quotes: readonly ComposerQuote[]) {
  const normalized = normalize(key)
  if (!normalized) return
  const usable = (quotes ?? [])
    .filter(quote => String(quote?.id ?? '').trim() && String(quote?.text ?? '').trim())
    .map(quote => ({ id: String(quote.id), text: String(quote.text), sourceLabel: quote.sourceLabel }))
  if (!usable.length) {
    // 空写不等于删除。切换对话的路径会顺手写一次空数组（那时引用状态还没恢复），
    // 若沿用草稿旧版的"空即删除"，读者的引用就会在切走的一瞬间被清掉
    // （真机 beta.41 复现：有引用时切换对话，切回来引用没了、文字还在）。
    // 真正要清空请显式调用 clearComposerQuotes（发送后就是那条路）。
    return
  }
  quotesByKey.set(normalized, usable)
  quoteAt.set(normalized, Date.now())
  quoteOrder.set(normalized, ++quoteSeq)
  flush()
}

export function clearComposerQuotes(key: string) {
  const normalized = normalize(key)
  quotesByKey.delete(normalized)
  quoteAt.delete(normalized)
  quoteOrder.delete(normalized)
  flush()
}

export function resetComposerQuotes() {
  quotesByKey.clear()
  flush()
}

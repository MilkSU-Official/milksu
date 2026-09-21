import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { companionPrefersUiMotion } from '@/lib/companionPetMotion'

/** Matches `--motion-base`. Enter, leave, and FLIP all share this hold. */
export const COMPANION_CHAT_LIST_MOTION_MS = 180

export type CompanionChatMotionKind =
  | 'older'
  | 'entry'
  | 'live-process'
  | 'live-stream'
  | 'live-settled'
  | 'live-typing'

export type CompanionChatMotionItem = {
  key: string
  fingerprint: string
}

export function companionChatRowFingerprint(input: {
  kind: CompanionChatMotionKind
  role?: string
  text?: string
  processOnly?: boolean
}) {
  if (input.kind === 'older') return 'older'
  if (input.kind === 'live-typing') return 'live-typing'
  if (input.kind === 'live-process' || input.kind === 'live-settled' || input.processOnly) {
    return 'process'
  }
  const role = input.role || 'note'
  const text = String(input.text || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  return `${role}:${text}`
}

/**
 * When the sidecar rewrites a pending / live id into a durable transcript id,
 * treat it as the same row so the bubble does not leave and re-enter.
 */
export function aliasCompanionChatKeys(
  previous: CompanionChatMotionItem[],
  next: CompanionChatMotionItem[],
): Map<string, string> {
  const prevKeys = new Set(previous.map(item => item.key))
  const used = new Set<string>()
  const nextByFingerprint = new Map<string, string[]>()
  for (const item of next) {
    const group = nextByFingerprint.get(item.fingerprint) ?? []
    group.push(item.key)
    nextByFingerprint.set(item.fingerprint, group)
  }
  const alias = new Map<string, string>()
  for (const item of previous) {
    if (next.some(candidate => candidate.key === item.key)) {
      used.add(item.key)
      continue
    }
    const fresh = (nextByFingerprint.get(item.fingerprint) ?? []).find(key => {
      return !used.has(key) && !prevKeys.has(key)
    })
    if (!fresh) continue
    alias.set(item.key, fresh)
    used.add(fresh)
  }
  const takeFresh = (match: (item: CompanionChatMotionItem) => boolean) => {
    const found = next.find(item => !used.has(item.key) && !prevKeys.has(item.key) && match(item))
    if (!found) return
    used.add(found.key)
    return found.key
  }
  for (const item of previous) {
    if (next.some(candidate => candidate.key === item.key) || alias.has(item.key)) continue
    if (item.key === 'live:stream') {
      const target = takeFresh(candidate => candidate.fingerprint.startsWith('assistant:'))
      if (target) alias.set(item.key, target)
      continue
    }
    if (item.key === 'live:process' || item.key === 'live:settled') {
      const target = takeFresh(candidate => candidate.fingerprint === 'process')
      if (target) alias.set(item.key, target)
      continue
    }
    if (item.key.startsWith('pending:') || item.key.startsWith('live-user:')) {
      const target = takeFresh(candidate => candidate.fingerprint.startsWith('user:'))
      if (target) alias.set(item.key, target)
    }
  }
  return alias
}

export function useCompanionChatListMotion(
  logRef: RefObject<HTMLElement | null>,
  items: CompanionChatMotionItem[],
  layoutEpoch: string,
  stickToEndRef: RefObject<boolean>,
) {
  const prevItemsRef = useRef<CompanionChatMotionItem[]>(items)
  const leavingRef = useRef<CompanionChatMotionItem[]>([])
  const enteringRef = useRef(new Set<string>())
  const seenRef = useRef(new Set<string>())
  const hydratedRef = useRef(false)
  const nodesRef = useRef(new Map<string, HTMLElement>())
  const prevTopsRef = useRef(new Map<string, number>())
  const prevScrollRef = useRef({ height: 0, top: 0, firstKey: items[0]?.key ?? '' })
  const [, setTick] = useState(0)

  const alias = aliasCompanionChatKeys(prevItemsRef.current, items)
  const nextKeys = new Set(items.map(item => item.key))
  const newlyGone = prevItemsRef.current.filter(item => !nextKeys.has(item.key) && !alias.has(item.key))
  const born: string[] = []
  if (!companionPrefersUiMotion()) {
    leavingRef.current = []
    enteringRef.current.clear()
    for (const item of newlyGone) seenRef.current.delete(item.key)
    for (const [from, to] of alias) {
      seenRef.current.delete(from)
      seenRef.current.add(to)
    }
    for (const item of items) seenRef.current.add(item.key)
    hydratedRef.current = true
  } else if (!hydratedRef.current) {
    for (const item of items) seenRef.current.add(item.key)
    hydratedRef.current = true
    leavingRef.current = []
    enteringRef.current.clear()
  } else {
    for (const [from, to] of alias) {
      seenRef.current.add(to)
      seenRef.current.delete(from)
      enteringRef.current.delete(from)
    }
    for (const item of newlyGone) {
      seenRef.current.delete(item.key)
      enteringRef.current.delete(item.key)
    }
    const hold = new Map(leavingRef.current.map(item => [item.key, item]))
    for (const item of newlyGone) hold.set(item.key, item)
    leavingRef.current = [...hold.values()].filter(item => !nextKeys.has(item.key))
    for (const item of items) {
      if (seenRef.current.has(item.key) || [...alias.values()].includes(item.key)) continue
      born.push(item.key)
      seenRef.current.add(item.key)
      enteringRef.current.add(item.key)
    }
    for (const key of [...enteringRef.current]) {
      if (!nextKeys.has(key)) enteringRef.current.delete(key)
    }
  }
  const leaving = leavingRef.current
  const entering = [...enteringRef.current]

  const itemsKey = items.map(item => item.key).join('\n')

  useLayoutEffect(() => {
    const log = logRef.current
    const aliasNow = aliasCompanionChatKeys(prevItemsRef.current, items)

    const firstKey = items[0]?.key ?? ''
    const prepended = Boolean(
      firstKey
      && prevScrollRef.current.firstKey
      && firstKey !== prevScrollRef.current.firstKey
      && items.some(item => item.key === prevScrollRef.current.firstKey),
    )
    if (log) {
      if (prepended) {
        log.scrollTop = prevScrollRef.current.top + (log.scrollHeight - prevScrollRef.current.height)
      } else if (stickToEndRef.current) {
        log.scrollTop = Math.max(0, log.scrollHeight - log.clientHeight)
      }
    }

    if (companionPrefersUiMotion() && log) {
      const logTop = log.getBoundingClientRect().top
      const nextTops = new Map<string, number>()
      for (const [key, node] of nodesRef.current) {
        nextTops.set(key, node.getBoundingClientRect().top)
      }
      const enteringSet = new Set(enteringRef.current)
      const leavingSet = new Set(leavingRef.current.map(item => item.key))
      for (const [key, node] of nodesRef.current) {
        if (enteringSet.has(key) || leavingSet.has(key)) continue
        let prevTop = prevTopsRef.current.get(key)
        if (prevTop == null) {
          for (const [from, to] of aliasNow) {
            if (to === key) prevTop = prevTopsRef.current.get(from)
          }
        }
        const nextTop = nextTops.get(key)
        if (prevTop == null || nextTop == null) continue
        const dy = prevTop - nextTop
        if (Math.abs(dy) < 0.5) continue
        node.style.transition = 'none'
        node.style.transform = `translateY(${dy}px)`
        node.getBoundingClientRect()
        node.style.transition = 'transform var(--motion-base) var(--ease-out)'
        node.style.transform = 'translateY(0)'
        const finish = () => {
          node.style.transition = ''
          node.style.transform = ''
          node.removeEventListener('transitionend', finish)
        }
        node.addEventListener('transitionend', finish)
      }
      for (const item of leavingRef.current) {
        const node = nodesRef.current.get(item.key)
        const prevTop = prevTopsRef.current.get(item.key)
        if (!node || prevTop == null) continue
        const pad = Number.parseFloat(getComputedStyle(log).paddingTop) || 0
        node.style.position = 'absolute'
        node.style.left = '0'
        node.style.right = '0'
        node.style.top = `${prevTop - logTop + log.scrollTop - pad}px`
      }
      prevTopsRef.current = nextTops
    } else {
      prevTopsRef.current = new Map(
        [...nodesRef.current].map(([key, node]) => [key, node.getBoundingClientRect().top]),
      )
    }

    if (log) {
      prevScrollRef.current = {
        height: log.scrollHeight,
        top: log.scrollTop,
        firstKey,
      }
    }
    prevItemsRef.current = items

    if (!leavingRef.current.length && !enteringRef.current.size) return undefined
    const timer = window.setTimeout(() => {
      leavingRef.current = []
      enteringRef.current.clear()
      setTick(value => value + 1)
    }, COMPANION_CHAT_LIST_MOTION_MS)
    return () => window.clearTimeout(timer)
  }, [items, itemsKey, layoutEpoch, logRef, stickToEndRef])

  useLayoutEffect(() => {
    const log = logRef.current
    if (!log || typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(() => {
      if (!companionPrefersUiMotion() || !hydratedRef.current) return
      const nextTops = new Map<string, number>()
      for (const [key, node] of nodesRef.current) {
        nextTops.set(key, node.getBoundingClientRect().top)
      }
      const leavingSet = new Set(leavingRef.current.map(item => item.key))
      for (const [key, node] of nodesRef.current) {
        if (leavingSet.has(key) || enteringRef.current.has(key)) continue
        const prevTop = prevTopsRef.current.get(key)
        const nextTop = nextTops.get(key)
        if (prevTop == null || nextTop == null) continue
        const dy = prevTop - nextTop
        if (Math.abs(dy) < 0.5) continue
        node.style.transition = 'none'
        node.style.transform = `translateY(${dy}px)`
        node.getBoundingClientRect()
        node.style.transition = 'transform var(--motion-base) var(--ease-out)'
        node.style.transform = 'translateY(0)'
        const finish = () => {
          node.style.transition = ''
          node.style.transform = ''
          node.removeEventListener('transitionend', finish)
        }
        node.addEventListener('transitionend', finish)
      }
      prevTopsRef.current = nextTops
    })
    observer.observe(log)
    return () => observer.disconnect()
  }, [logRef])

  function bindRow(key: string) {
    return (node: HTMLElement | null) => {
      if (node) nodesRef.current.set(key, node)
      else nodesRef.current.delete(key)
    }
  }

  function motionFor(key: string): 'enter' | 'leave' | undefined {
    if (leaving.some(item => item.key === key)) return 'leave'
    if (entering.includes(key)) return 'enter'
    return undefined
  }

  return {
    leaving,
    motionFor,
    bindRow,
  }
}

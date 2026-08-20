import { buildChatActivityEntries, type ChatTranscriptBlock } from '@/lib/chatActivity'

export interface ChatActivityExpansionState {
  groups: ReadonlySet<string>
  entries: ReadonlyMap<string, ReadonlySet<string>>
}

const emptyEntrySet: ReadonlySet<string> = new Set()

export function createChatActivityExpansionState(): ChatActivityExpansionState {
  return { groups: new Set(), entries: new Map() }
}

export function chatActivityGroupOpen(
  state: ChatActivityExpansionState,
  activityId: string,
): boolean {
  return state.groups.has(activityId)
}

export function chatActivityOpenEntryIds(
  state: ChatActivityExpansionState,
  activityId: string,
): ReadonlySet<string> {
  return state.entries.get(activityId) ?? emptyEntrySet
}

export function setChatActivityGroupOpen(
  state: ChatActivityExpansionState,
  activityId: string,
  open: boolean,
): ChatActivityExpansionState {
  if (state.groups.has(activityId) === open) return state
  const groups = new Set(state.groups)
  if (open) groups.add(activityId)
  else groups.delete(activityId)
  return { groups, entries: state.entries }
}

export function setChatActivityEntryOpen(
  state: ChatActivityExpansionState,
  activityId: string,
  entryId: string,
  open: boolean,
): ChatActivityExpansionState {
  const existing = state.entries.get(activityId)
  if (Boolean(existing?.has(entryId)) === open) return state
  const entries = new Map(state.entries)
  const current = new Set(existing ?? [])
  if (open) current.add(entryId)
  else current.delete(entryId)
  if (current.size) entries.set(activityId, current)
  else entries.delete(activityId)
  return { groups: state.groups, entries }
}

export function pruneChatActivityExpansion(
  state: ChatActivityExpansionState,
  blocks: ChatTranscriptBlock[],
): ChatActivityExpansionState {
  const liveGroups = new Set<string>()
  const liveEntriesByGroup = new Map<string, Set<string>>()
  for (const block of blocks) {
    if (block.kind !== 'activity') continue
    liveGroups.add(block.id)
    liveEntriesByGroup.set(
      block.id,
      new Set(buildChatActivityEntries(block.messages).map(entry => entry.id)),
    )
  }

  let changed = false
  const groups = new Set<string>()
  for (const activityId of state.groups) {
    if (liveGroups.has(activityId)) groups.add(activityId)
    else changed = true
  }

  const entries = new Map<string, ReadonlySet<string>>()
  for (const [activityId, entryIds] of state.entries) {
    const live = liveEntriesByGroup.get(activityId)
    if (!live) {
      changed = true
      continue
    }
    const kept = new Set<string>()
    for (const entryId of entryIds) {
      if (live.has(entryId)) kept.add(entryId)
      else changed = true
    }
    if (kept.size) entries.set(activityId, kept)
  }

  if (!changed) return state
  return { groups, entries }
}

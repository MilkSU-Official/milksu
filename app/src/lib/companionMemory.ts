import type { CompanionApprovedMemory } from '@/types'

export function sortCompanionMemoriesNewestFirst(
  memories: CompanionApprovedMemory[],
): CompanionApprovedMemory[] {
  return [...memories].sort((left, right) => {
    const at = String(right.at ?? '').localeCompare(String(left.at ?? ''))
    if (at !== 0) return at
    return String(left.id ?? '').localeCompare(String(right.id ?? ''))
  })
}

export function filterCompanionMemories(
  memories: CompanionApprovedMemory[],
  query: string,
): CompanionApprovedMemory[] {
  const needle = String(query ?? '').trim().toLowerCase()
  if (!needle) return memories
  return memories.filter(item => [item.title, item.markdown, item.evidence]
    .map(part => String(part ?? '').toLowerCase())
    .some(part => part.includes(needle)))
}

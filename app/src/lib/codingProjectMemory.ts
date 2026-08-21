import { isGeneratedScratchWorkspace } from '@/lib/codingConversationGroups'

export const LOCAL_CODING_SHELL_ID = 'local-shell'

export function codingWorkspaceLabel(path?: string | null, homeDirectory?: string | null) {
  const normalized = String(path ?? '').replace(/[/\\]+$/, '')
  if (!normalized) return ''
  const home = String(homeDirectory ?? '').replace(/[/\\]+$/, '')
  if (home && normalized === home) return '~'
  return normalized.split(/[/\\]/).filter(Boolean).at(-1) || ''
}

export function shouldRememberCodingProject(path?: string | null) {
  const normalized = String(path ?? '').trim()
  if (!normalized) return false
  return !isGeneratedScratchWorkspace(normalized)
}

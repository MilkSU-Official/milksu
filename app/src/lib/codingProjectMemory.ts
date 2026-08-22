import { isGeneratedScratchWorkspace } from '@/lib/codingConversationGroups'

export const LOCAL_CODING_SHELL_ID = 'local-shell'

export function codingWorkspaceLabel(path?: string | null, homeDirectory?: string | null) {
  const normalized = String(path ?? '').replace(/[/\\]+$/, '')
  if (!normalized) return ''
  const home = String(homeDirectory ?? '').replace(/[/\\]+$/, '')
  if (home && normalized === home) return '~'
  const name = normalized.split(/[/\\]/).filter(Boolean).at(-1) || ''
  return isGenericWorkspaceLabel(name) ? '' : name
}

export function isGenericWorkspaceLabel(name?: string | null) {
  const value = String(name ?? '').trim()
  if (!value || value === '~' || value === '无项目任务') return true
  if (/^[a-f0-9]{8,}$/i.test(value)) return true
  if (/^(?:lab|cve|ctf|coding|实验室作业)-[a-f0-9]{6,}$/i.test(value)) return true
  if (/(?:新编码任务|临时任务|无项目任务)-[a-f0-9]{8}$/u.test(value)) return true
  return false
}

export function shouldRememberCodingProject(path?: string | null) {
  const normalized = String(path ?? '').trim()
  if (!normalized) return false
  if (isGeneratedScratchWorkspace(normalized)) return false
  const name = normalized.split(/[/\\]/).filter(Boolean).at(-1) || ''
  if (isGenericWorkspaceLabel(name)) return false
  if (/\/MilkSU\/(?:Lab|CVE|CTF)\//u.test(normalized.replaceAll('\\', '/'))) return false
  return true
}

import { isGeneratedScratchWorkspace } from '@/lib/codingConversationGroups'
import { t } from '@/lib/uiLocale'

export interface ChatTopbarInput {
  ctfSession: boolean
  vulnerabilitySession?: boolean
  conversationTitle?: string
  workspacePath?: string
  codingPolicyLabel: string
  ctfMode?: 'coach' | 'copilot' | 'delegate'
}

function ctfModeLabel(mode: ChatTopbarInput['ctfMode']) {
  if (mode === 'coach') return t('教练', 'Coach')
  if (mode === 'delegate') return t('代理', 'Delegate')
  return t('搭档', 'Copilot')
}

function workspaceBaseName(path?: string) {
  const value = (path || '').replace(/[/\\]+$/, '')
  return value.split(/[/\\]/).at(-1) || ''
}

export function chatTopbarPresentation(input: ChatTopbarInput) {
  const workspacePath = isGeneratedScratchWorkspace(input.workspacePath)
    ? ''
    : input.workspacePath
  if (input.ctfSession) {
    return {
      title: 'CTF',
      subtitle: `${input.conversationTitle || t('解题会话', 'Solving session')} · ${ctfModeLabel(input.ctfMode)}`,
    }
  }

  const workspaceLabel = workspacePath ? workspaceBaseName(workspacePath) : ''

  if (input.vulnerabilitySession) {
    return {
      title: 'CVE',
      subtitle: `${input.conversationTitle || t('CVE 接力', 'CVE handoff')} · ${workspaceLabel || t(`临时工作区 · ${input.codingPolicyLabel}`, `Temporary workspace · ${input.codingPolicyLabel}`)}`,
    }
  }

  return {
    title: input.conversationTitle || t('新编码任务', 'New coding task'),
    subtitle: workspaceLabel || t(`临时工作区 · ${input.codingPolicyLabel}`, `Temporary workspace · ${input.codingPolicyLabel}`),
  }
}

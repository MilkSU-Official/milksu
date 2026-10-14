import { isGeneratedScratchWorkspace } from '@/lib/codingConversationGroups'
import { t } from '@/lib/uiLocale'

export interface ChatTopbarInput {
  vulnerabilitySession?: boolean
  conversationTitle?: string
  workspacePath?: string
  codingPolicyLabel: string
}

function workspaceBaseName(path?: string) {
  const value = (path || '').replace(/[/\\]+$/, '')
  return value.split(/[/\\]/).at(-1) || ''
}

export function chatTopbarPresentation(input: ChatTopbarInput) {
  const workspacePath = isGeneratedScratchWorkspace(input.workspacePath)
    ? ''
    : input.workspacePath

  const workspaceLabel = workspacePath ? workspaceBaseName(workspacePath) : ''

  if (input.vulnerabilitySession) {
    return {
      title: 'CVE',
      subtitle: `${input.conversationTitle || t('CVE 接力', 'CVE handoff')} · ${workspaceLabel || t(`临时工作区 · ${input.codingPolicyLabel}`, `Temporary workspace · ${input.codingPolicyLabel}`)}`,
    }
  }

  return {
    title: input.conversationTitle || t('新编码任务', 'New coding task'),
    subtitle: workspaceLabel,
  }
}

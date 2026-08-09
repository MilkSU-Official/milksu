export interface ChatTopbarInput {
  ctfSession: boolean
  vulnerabilitySession?: boolean
  conversationTitle?: string
  workspacePath?: string
  codingPolicyLabel: string
  ctfMode?: 'coach' | 'copilot' | 'delegate'
}

function ctfModeLabel(mode: ChatTopbarInput['ctfMode']) {
  if (mode === 'coach') return '教练'
  if (mode === 'delegate') return '代理'
  return '搭档'
}

export function chatTopbarPresentation(input: ChatTopbarInput) {
  if (input.ctfSession) {
    return {
      title: 'CTF',
      subtitle: `${input.conversationTitle || '解题会话'} · ${ctfModeLabel(input.ctfMode)}`,
    }
  }

  if (input.vulnerabilitySession) {
    return {
      title: 'CVE',
      subtitle: `${input.conversationTitle || 'CVE 接力'} · ${input.workspacePath || `临时工作区 · ${input.codingPolicyLabel}`}`,
    }
  }

  return {
    title: input.conversationTitle || '新编码任务',
    subtitle: input.workspacePath || `临时工作区 · ${input.codingPolicyLabel}`,
  }
}

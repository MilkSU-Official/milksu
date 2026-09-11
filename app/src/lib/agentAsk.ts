export const codingAskToolName = 'milksu_ask'
export const askOtherChoiceId = 'other'
export const askOtherChoicePrefix = 'other:'

export interface AgentAskOption {
  id: string
  label: string
  detail?: string
}

export function encodeAskOtherChoice(text: string) {
  return `${askOtherChoicePrefix}${String(text ?? '').trim()}`
}

export function decodeAskOtherChoice(choice?: string) {
  const raw = String(choice ?? '')
  if (!raw.startsWith(askOtherChoicePrefix)) return ''
  return raw.slice(askOtherChoicePrefix.length).trim()
}

export function askApprovalChoice(choice?: string) {
  const raw = String(choice ?? '').trim()
  const otherText = decodeAskOtherChoice(raw)
  if (otherText) return { id: askOtherChoiceId, otherText }
  return { id: raw, otherText: '' }
}

export function parseAskOptions(input?: string): AgentAskOption[] {
  try {
    const parsed = JSON.parse(String(input ?? '')) as { options?: unknown }
    const raw = Array.isArray(parsed.options) ? parsed.options : []
    const options: AgentAskOption[] = []
    const used = new Set<string>()
    for (const item of raw) {
      if (options.length >= 6) break
      const record = (
        item && typeof item === 'object' ? item : { label: item }
      ) as Record<string, unknown>
      const label = String(record.label ?? record.text ?? '').trim().slice(0, 80)
      if (!label) continue
      let id = String(record.id ?? '')
        .trim()
        .toLocaleLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32)
      if (!id || id === askOtherChoiceId) id = `option-${options.length + 1}`
      while (used.has(id) || id === askOtherChoiceId) id = `${id}-${options.length + 1}`
      used.add(id)
      const detail = String(record.detail ?? record.description ?? '').trim().slice(0, 160)
      options.push(detail ? { id, label, detail } : { id, label })
    }
    return options
  } catch {
    return []
  }
}

export function isAskMessage(message: { toolName?: string; approvalRequestId?: string }) {
  return message.toolName === codingAskToolName && Boolean(message.approvalRequestId)
}

export function pendingAskMessage<T extends {
  toolName?: string
  approvalRequestId?: string
  approvalState?: string
}>(messages?: T[]) {
  if (!Array.isArray(messages)) return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (isAskMessage(message) && message.approvalState === 'pending') return message
  }
  return undefined
}

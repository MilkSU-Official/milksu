export const codingAskToolName = 'milksu_ask'

export interface AgentAskOption {
  id: string
  label: string
  detail?: string
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
      if (!id) id = `option-${options.length + 1}`
      while (used.has(id)) id = `${id}-${options.length + 1}`
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

import type { Message } from '@/types'

/** Concise execution plan published by the Pi `milksu_progress` tool. */
export type CodingPlanStepStatus = 'pending' | 'in_progress' | 'completed'

export interface CodingPlanStep {
  text: string
  status: CodingPlanStepStatus
}

export interface CodingPlan {
  summary: string
  steps: CodingPlanStep[]
}

const statusFromMarker: Record<string, CodingPlanStepStatus> = {
  ' ': 'pending',
  '>': 'in_progress',
  x: 'completed',
  X: 'completed',
}

/**
 * Parse a milksu_progress tool payload: either the checklist text the tool
 * returns, or the JSON args shown while the call is still running.
 */
export function parseCodingPlanContent(content: string): CodingPlan | null {
  const raw = String(content ?? '').trim()
  if (!raw) return null

  const fromJSON = parsePlanJSON(raw)
  if (fromJSON) return fromJSON

  return parsePlanChecklist(raw)
}

function parsePlanJSON(raw: string): CodingPlan | null {
  if (!raw.startsWith('{') && !raw.startsWith('[')) return null
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    const summary = String(record.summary ?? '').trim()
    const steps = normalizeSteps(record.steps)
    if (!summary || !steps.length) return null
    return { summary: summary.slice(0, 240), steps: steps.slice(0, 8) }
  } catch {
    return null
  }
}

function normalizeSteps(value: unknown): CodingPlanStep[] {
  if (!Array.isArray(value)) return []
  const steps: CodingPlanStep[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const text = String((item as { text?: unknown }).text ?? '').trim()
    const status = normalizeStatus((item as { status?: unknown }).status)
    if (!text || !status) continue
    steps.push({ text: text.slice(0, 180), status })
  }
  return steps
}

function normalizeStatus(value: unknown): CodingPlanStepStatus | null {
  const status = String(value ?? '').trim().toLowerCase()
  if (status === 'pending' || status === 'in_progress' || status === 'completed') {
    return status
  }
  return null
}

function parsePlanChecklist(raw: string): CodingPlan | null {
  const lines = raw.split(/\r?\n/).map(line => line.trimEnd())
  const stepLines: { index: number, step: CodingPlanStep }[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\[([ xX>])\]\s+(.+)$/)
    if (!match) continue
    const status = statusFromMarker[match[1]]
    const text = match[2].trim()
    if (!status || !text) continue
    stepLines.push({
      index,
      step: { text: text.slice(0, 180), status },
    })
  }
  if (!stepLines.length) return null

  const firstStepIndex = stepLines[0].index
  const summary = lines
    .slice(0, firstStepIndex)
    .map(line => line.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 240)
  if (!summary) return null

  return {
    summary,
    steps: stepLines.map(item => item.step).slice(0, 8),
  }
}

/**
 * Latest milksu_progress plan from the conversation transcript.
 * Prefers a completed result; falls back to a running call's args projection.
 * Returns null when the model has not published a plan.
 */
export function latestCodingPlan(messages: Message[]): CodingPlan | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'tool') continue
    if (String(message.toolName ?? '').toLowerCase() !== 'milksu_progress') continue
    const plan = parseCodingPlanContent(message.content)
    if (plan) return plan
  }
  return null
}

import { trimString } from './util.ts'

export const HOST_NOTICE_PREFIX = 'companion-host-notice'

export type MemoryCommit = {
  action: string
  existingId: string
  title: string
  markdown: string
  evidence: string
}

export type NoulJudge = (
  state: Record<string, string>,
  instructions: string,
) => Promise<number>

function speaksWithoutDecision(kind: string): boolean {
  switch (trimString(kind)) {
    case 'settled':
    case 'completed':
    case 'needs_approval':
    case 'error':
      return true
    default:
      return false
  }
}

export async function shouldSpeak(
  judge: NoulJudge | null,
  title: string,
  kind: string,
  task: string,
): Promise<boolean> {
  if (speaksWithoutDecision(kind)) return true
  if (trimString(kind) !== 'stall') return false
  if (!judge) return false
  try {
    const yes = await judge({
      title: trimString(title),
      event: 'stall',
      task: trimString(task),
    }, 'Should the companion speak to the user about this event now? Say yes only when a short update would help. Say no for routine progress.')
    return yes >= 0.5
  } catch {
    return false
  }
}

export function mergeHostNotice(current: string, next: string): string {
  const left = current.trim()
  const right = next.trim()
  if (!left || left === right) return right
  if (!right) return left
  const lines = right.split('\n')
  let extra = right
  if (lines.length >= 3 && lines[0] === HOST_NOTICE_PREFIX) {
    extra = `${lines[1]}\n${lines[2]}`
  }
  if (left.includes(extra)) return left
  return `${left}\n${right}`
}

export function hostNoticePrompt(title: string, kind: string, locale: string): string {
  const line = locale === 'en'
    ? 'Tell the user in one or two sentences. Lead with the conversation title. Do not read the first marker line aloud.'
    : '用一两句告诉用户。先说对话标题。不要念出第一行标记。'
  return `${HOST_NOTICE_PREFIX}\n${title.trim()}\n${kind.trim()}\n${line}`
}

export function imageHandoffLine(locale: string): string {
  return locale === 'en'
    ? "The attached pictures are this turn's result. Use these, and do not look for a different file."
    : '附上的图片就是这次的结果。用这几张，不要再去找别的文件。'
}

export function isHostNoticeText(text: string): boolean {
  return text.trim().startsWith(HOST_NOTICE_PREFIX)
}

export function companionImageHandoffText(text: string): string {
  const marker = '[MilkSU attachments]'
  const index = text.indexOf(marker)
  if (index < 0) return ''
  return text.slice(index).trim()
}

export function keepMemoryItemSync(item: MemoryCommit, userText: string): boolean {
  return Boolean(item.title.trim() && item.markdown.trim() && item.evidence.trim() && userText.trim()
    && userText.includes(item.evidence.trim()))
}

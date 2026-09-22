export type CompanionChatPiece =
  | { kind: 'bubble'; text: string }
  | { kind: 'note'; title: string; text: string }

const SHORT_CHARS = 180

function paragraphs(text: string) {
  return String(text ?? '')
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean)
}

function isShortParagraph(value: string) {
  if (value.length > SHORT_CHARS) return false
  if (value.includes('```')) return false
  if (/^#{1,6}\s/m.test(value)) return false
  if ((value.match(/^\s*(?:[-*]|\d+[.)])\s/gm) || []).length >= 3) return false
  if (value.split('\n').length > 5) return false
  return true
}

function noteTitle(body: string) {
  const heading = body.match(/^#{1,6}\s+(.+)$/m)
  const raw = (heading?.[1] ?? body.split('\n').find(line => line.trim()) ?? '').trim()
  const clean = raw.replace(/^[#>*\-\d.)\s]+/, '').trim()
  if (!clean) return ''
  return clean.length > 28 ? `${clean.slice(0, 28)}…` : clean
}

/** Chat style keeps short paragraphs as bubbles and folds the long middle into one note. */
export function companionChatPieces(text: string, style: 'markdown' | 'chat'): CompanionChatPiece[] {
  const source = String(text ?? '').trim()
  if (!source) return []
  if (style !== 'chat') return [{ kind: 'bubble', text: source }]
  const parts = paragraphs(source)
  if (!parts.length) return []
  if (parts.every(isShortParagraph)) {
    return parts.map(part => ({ kind: 'bubble', text: part }))
  }
  const lead: string[] = []
  while (parts.length > 1 && isShortParagraph(parts[0]) && lead.length < 2) {
    lead.push(parts.shift()!)
  }
  const tail: string[] = []
  while (parts.length > 1 && isShortParagraph(parts[parts.length - 1]) && tail.length < 2) {
    tail.unshift(parts.pop()!)
  }
  const body = parts.join('\n\n').trim()
  const pieces: CompanionChatPiece[] = lead.map(part => ({ kind: 'bubble', text: part }))
  if (body) pieces.push({ kind: 'note', title: noteTitle(body), text: body })
  for (const part of tail) pieces.push({ kind: 'bubble', text: part })
  return pieces.length ? pieces : [{ kind: 'bubble', text: source }]
}

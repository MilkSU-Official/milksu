const cveIDPattern = /^CVE-\d{4}-\d{4,}$/

export type CveLearningSavePlan = {
  ensure: {
    cveId: string
    title: string
    summary?: string
    referenceHref?: string
  }
  content: string
}

function clipRunes(value: string, max: number) {
  const runes = Array.from(value)
  if (runes.length <= max) return value
  return runes.slice(0, max).join('')
}

function httpReference(value: string) {
  const href = value.trim()
  if (!href) return ''
  try {
    const parsed = new URL(href)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    if (!parsed.host || parsed.username || parsed.password) return ''
    return href
  } catch {
    return ''
  }
}

export function prepareCveLearningSave(input: {
  cveId: string
  title?: string
  summary?: string
  referenceHrefs?: string[]
  content: string
}): CveLearningSavePlan | null {
  const cveId = input.cveId.trim().toUpperCase()
  if (!cveIDPattern.test(cveId)) return null
  const content = clipRunes(input.content.trim(), 4000)
  if (!content) return null
  const title = clipRunes((input.title ?? '').trim(), 180) || cveId
  const summary = clipRunes((input.summary ?? '').trim(), 1200)
  const referenceHref = (input.referenceHrefs ?? []).map(httpReference).find(Boolean) ?? ''
  return {
    ensure: {
      cveId,
      title,
      ...(summary ? { summary } : {}),
      ...(referenceHref ? { referenceHref } : {}),
    },
    content,
  }
}

export function orderCveLearningNotes<T extends { id: string; createdAt?: string }>(records: readonly T[]): T[] {
  return [...records].sort((left, right) => {
    const at = (left.createdAt ?? '').localeCompare(right.createdAt ?? '')
    if (at !== 0) return at
    return left.id.localeCompare(right.id)
  })
}

export type UnifiedDiffLineKind =
  | 'addition'
  | 'deletion'
  | 'context'
  | 'metadata'

export interface UnifiedDiffLine {
  kind: UnifiedDiffLineKind
  text: string
}

export interface UnifiedDiffHunk {
  id: string
  header: string
  patch: string
  lines: UnifiedDiffLine[]
}

function splitLinesPreservingNewline(value: string): string[] {
  return value.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

function displayLine(value: string): UnifiedDiffLine {
  const text = value.endsWith('\n') ? value.slice(0, -1) : value
  if (text.startsWith('+') && !text.startsWith('+++')) {
    return { kind: 'addition', text }
  }
  if (text.startsWith('-') && !text.startsWith('---')) {
    return { kind: 'deletion', text }
  }
  if (text.startsWith(' ')) {
    return { kind: 'context', text }
  }
  return { kind: 'metadata', text }
}

export function parseUnifiedDiffHunks(value: string): UnifiedDiffHunk[] {
  if (!value || value.includes('…diff truncated by MilkSU')) return []
  const lines = splitLinesPreservingNewline(value)
  const firstHunk = lines.findIndex(line => line.startsWith('@@ '))
  if (firstHunk < 0) return []

  const header = lines.slice(0, firstHunk).join('')
  if (
    !header.startsWith('diff --git ')
    || !header.includes('\n--- ')
    || !header.includes('\n+++ ')
    || header.includes('\n--- /dev/null')
    || header.includes('\n+++ /dev/null')
    || header.includes('\nnew file mode ')
    || header.includes('\ndeleted file mode ')
    || header.includes('\nrename from ')
    || header.includes('\nrename to ')
  ) {
    return []
  }

  const starts: number[] = []
  for (let index = firstHunk; index < lines.length; index += 1) {
    if (lines[index]?.startsWith('@@ ')) starts.push(index)
  }
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? lines.length
    const hunkLines = lines.slice(start, end)
    const hunkHeader = (hunkLines[0] ?? '').replace(/\n$/, '')
    return {
      id: `${start}:${hunkHeader}`,
      header: hunkHeader,
      patch: header + hunkLines.join(''),
      lines: hunkLines.slice(1).map(displayLine),
    }
  })
}

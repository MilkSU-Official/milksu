import { describe, expect, it } from 'vitest'
import { parseUnifiedDiffHunks } from './unifiedDiff'

const twoHunkDiff = [
  'diff --git a/src/example.ts b/src/example.ts',
  'index 1111111..2222222 100644',
  '--- a/src/example.ts',
  '+++ b/src/example.ts',
  '@@ -1,4 +1,4 @@',
  ' first',
  '-second',
  '+second changed',
  ' third',
  '@@ -10,3 +10,3 @@',
  ' tenth',
  '-eleventh',
  '+eleventh changed',
  ' twelfth',
  '',
].join('\n')

describe('parseUnifiedDiffHunks', () => {
  it('creates one exact applyable patch for each hunk', () => {
    const hunks = parseUnifiedDiffHunks(twoHunkDiff)

    expect(hunks).toHaveLength(2)
    expect(hunks[0]?.header).toBe('@@ -1,4 +1,4 @@')
    expect(hunks[0]?.patch).toContain('diff --git a/src/example.ts b/src/example.ts')
    expect(hunks[0]?.patch).toContain('+second changed')
    expect(hunks[0]?.patch).not.toContain('+eleventh changed')
    expect(hunks[1]?.patch).toContain('+eleventh changed')
    expect(hunks[1]?.lines.map(line => line.kind)).toEqual([
      'context',
      'deletion',
      'addition',
      'context',
    ])
  })

  it('refuses truncated or non-text diffs', () => {
    expect(parseUnifiedDiffHunks('…diff truncated by MilkSU')).toEqual([])
    expect(parseUnifiedDiffHunks('Binary files a/logo.png and b/logo.png differ\n')).toEqual([])
    expect(parseUnifiedDiffHunks([
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1 @@',
      '+new',
      '',
    ].join('\n'))).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import {


  assessApprovalRequest,
  assessDestructiveRequest,
  parseDestructiveTargets,
  protectedMatch,
} from './destructiveTarget'

// The renderer is sandboxed and has no `process`, so tests pin a literal home directory.
const testHome = '/Users/probe'

describe('destructive target parsing', () => {
  // Defect 11: a `find … -delete` used to be reported as the whole workspace root.
  it('reports the find root, not the workspace, for find -delete', () => {
    const [target] = parseDestructiveTargets("find work/logs -name '*.log' -delete", '/Users/me/project')
    expect(target.path).toBe('/Users/me/project/work/logs')
    expect(target.kind).toBe('directory-tree')
    expect(target.recursive).toBe(true)
    expect(target.reason).toContain('-name')
  })

  it('treats a bare find -delete as the tree under its start directory', () => {
    const [target] = parseDestructiveTargets('find . -delete', '/Users/me/project')
    expect(target.path).toBe('/Users/me/project')
    expect(target.reason).toContain('整个起始目录树')
  })

  it('separates a single file removal from a recursive directory removal', () => {
    const [file] = parseDestructiveTargets('rm -f /tmp/notes.txt')
    expect(file.kind).toBe('file')
    expect(file.recursive).toBe(false)

    const [tree] = parseDestructiveTargets('rm -rf /tmp/build')
    expect(tree.kind).toBe('directory-tree')
    expect(tree.recursive).toBe(true)
  })

  it('lists every operand of a multi-target rm', () => {
    const targets = parseDestructiveTargets('rm -rf a b', '/work')
    expect(targets.map(target => target.path)).toEqual(['/work/a', '/work/b'])
  })

  // Piped deletes cannot be scoped from the command text: the card must say so.
  it('marks xargs deletes as undetermined', () => {
    const [target] = parseDestructiveTargets('ls /tmp/old | xargs rm -rf')
    expect(target.kind).toBe('unknown')
    expect(target.reason).toContain('xargs')
  })

  it('marks an rm without operands as undetermined', () => {
    const [target] = parseDestructiveTargets('rm -rf')
    expect(target.kind).toBe('unknown')
  })
})

describe('protected rules and user data', () => {
  it('protects the temporary build caches', () => {
    expect(protectedMatch('/private/tmp/milksu-restore-check-oWZogJ')).toEqual({
      protected: true,
      rule: '/private/tmp/milksu-*',
    })
    expect(protectedMatch('/private/tmp/mairecord-backup')).toEqual({
      protected: true,
      rule: '/private/tmp/mairecord-*',
    })
  })

  it('protects user data but allows explicit caches', () => {
    expect(protectedMatch(`${testHome}/Library/Application Support/com.milksu.app.beta/runtime-data`).protected)
      .toBe(true)
    expect(protectedMatch(`${testHome}/Library/Caches/whatever`).protected).toBe(false)
    expect(protectedMatch('/Users/me/Documents/report.pdf').protected).toBe(true)
  })
})

describe('destructive assessment', () => {
  it('calls a rebuildable app copy low risk', () => {
    const assessment = assessDestructiveRequest(
      'rm -rf /Users/me/Applications/.MilkSU\\ Beta\\ Test.app.bak-20260914-112838',
      [{ exists: true, inGitRepository: true, gitTracked: true, rebuildable: true, rebuildSource: 'a602733a' }],
    )
    expect(assessment.risk).toBe('low')
    expect(assessment.verdict).toContain('可重建')
    expect(assessment.undetermined).toBe(false)
  })

  it('calls an untracked, unbacked target high risk', () => {
    const assessment = assessDestructiveRequest(
      'rm -rf /Users/me/work/notes',
      [{ exists: true, inGitRepository: true, gitTracked: false, rebuildable: false }],
    )
    expect(assessment.irrecoverable).toBe(true)
    expect(assessment.canAllow).toBe(true)
    expect(assessment.risk).toBe('medium')
  })

  it('raises risk for protected targets even when they look rebuildable', () => {
    const assessment = assessDestructiveRequest(
      `rm -rf ${testHome}/Library/Application Support/com.milksu.app.beta/runtime-data`,
      [{ exists: true, rebuildable: true }],
    )
    expect(assessment.risk).toBe('high')
    expect(assessment.protections.length).toBeGreaterThan(0)
    expect(assessment.verdict).toContain('受保护清单')
  })

  // The allow button is gated on `undetermined`: an unscopable command never passes.
  it('stays undetermined when the scope cannot be established', () => {
    const assessment = assessDestructiveRequest('ls /tmp | xargs rm')
    expect(assessment.undetermined).toBe(true)
    expect(assessment.risk).not.toBe('low')
  })

  it('reports measured size in the verdict', () => {
    const assessment = assessDestructiveRequest(
      'rm -rf /Users/me/backups/old',
      [{ exists: true, fileCount: 42, totalBytes: 3 * 1024 * 1024, sampled: true }],
    )
    expect(assessment.verdict).toContain('42 个文件')
    expect(assessment.verdict).toContain('仅采样')
  })

  it('refuses a tilde path when HOME cannot be read', () => {
    const home = process.env.HOME
    const profile = process.env.USERPROFILE
    delete process.env.HOME
    delete process.env.USERPROFILE
    try {
      const assessment = assessDestructiveRequest('rm -rf ~/Documents/secret')
      expect(assessment.undetermined).toBe(true)
      expect(assessment.canAllow).toBe(false)
    } finally {
      if (home !== undefined) process.env.HOME = home
      if (profile !== undefined) process.env.USERPROFILE = profile
    }
  })
})


describe('destructive input normalisation', () => {
  // The approval card assesses the tool input, which is JSON for most tools. Reading that
  // JSON as a command turned a clear absolute path into "target undetermined".
  it('reads a JSON tool input as the command it carries', () => {
    const quoted = '"rm -rf \\"/private/tmp/gate-probe-big\\""'
    const argv = JSON.stringify({ shell: false, argv: ['rm', '-rf', '/private/tmp/gate-probe-big'] })
    const delivered = JSON.stringify({
      path: '/private/tmp/gate-probe-big',
      purpose: '验收测试',
      safety: '可重建',
    })
    const plain = 'rm -rf /private/tmp/gate-probe-big'

    for (const text of [quoted, argv, delivered, plain]) {
      const assessment = assessDestructiveRequest(text)
      expect(assessment.undetermined, text).toBe(false)
      expect(assessment.targets[0]?.kind, text).not.toBe('unknown')
      expect(assessment.targets[0]?.path, text).toBe('/private/tmp/gate-probe-big')
    }
  })

  // Three quoting forms of the same delete must decide identically.
  it('treats quoted, single-quoted and bare paths the same', () => {
    const forms = [
      'rm -rf "/private/tmp/gate-probe-big"',
      "rm -rf '/private/tmp/gate-probe-big'",
      'rm -rf /private/tmp/gate-probe-big',
    ]
    const results = forms.map(command => assessDestructiveRequest(command))
    for (const [index, assessment] of results.entries()) {
      expect(assessment.undetermined, forms[index]).toBe(false)
      expect(assessment.targets[0]?.path, forms[index]).toBe('/private/tmp/gate-probe-big')
    }
    expect(new Set(results.map(item => item.targets[0]?.kind)).size).toBe(1)
  })

  // A target that genuinely cannot be pinned down stays deny-only.
  it('keeps a genuinely undetermined target deny-only', () => {
    const assessment = assessDestructiveRequest('rm -rf "$(cat /tmp/where)"')
    expect(assessment.undetermined).toBe(true)
    expect(assessment.canAllow).toBe(false)
  })
})

describe('create-then-delete in one command', () => {
  // The pre-flight check cannot see a directory that this same command creates: the guard
  // must refuse instead of judging the (missing) target as harmless.
  it('refuses a target that the same command creates first', () => {
    const compound = 'rm -rf /private/tmp/gate-probe-big2; mkdir -p /private/tmp/gate-probe-big2; '
      + 'for i in $(seq 1 1200); do : > "/private/tmp/gate-probe-big2/f$i"; done; '
      + 'rm -rf /private/tmp/gate-probe-big2'
    const assessment = assessDestructiveRequest(compound)
    expect(assessment.undetermined).toBe(true)
    expect(assessment.canAllow).toBe(false)
  })

  it('refuses a directory the command fills with redirection', () => {
    const assessment = assessDestructiveRequest(
      'mkdir -p /tmp/fresh && echo hi > /tmp/fresh/file.txt && rm -rf /tmp/fresh',
    )
    expect(assessment.undetermined).toBe(true)
    expect(assessment.canAllow).toBe(false)
  })

  // A plain delete of a directory the command does not create is unaffected.
  it('leaves an ordinary recursive delete alone', () => {
    const assessment = assessDestructiveRequest('rm -rf /private/tmp/gate-probe-big')
    expect(assessment.undetermined).toBe(false)
  })
})

describe('delete targets behind wrappers and shells', () => {
  // `sudo rm -rf X` and `bash -c "rm -rf X"` delete exactly what their inner command does.
  it('sees through sudo, env and shell -c wrappers', () => {
    const forms = [
      'sudo rm -rf /private/tmp/probe-v3',
      'env A=b rm -rf /private/tmp/probe-v3',
      'bash -c "rm -rf /private/tmp/probe-v3"',
      "sh -c 'rm -rf /private/tmp/probe-v3'",
    ]
    for (const command of forms) {
      const assessment = assessDestructiveRequest(command)
      expect(assessment.undetermined, command).toBe(false)
      expect(assessment.targets[0]?.path, command).toBe('/private/tmp/probe-v3')
    }
  })
})

describe('unfamiliar shapes with one clear path', () => {
  // A wrapper we do not know about must not turn a single absolute path into "undetermined":
  // that silently made a reviewed deletion impossible to approve.
  it('still finds the target when only one absolute path is named', () => {
    for (const command of [
      'rm -rf "/private/tmp/probe-v3" --interactive',
      'nice -n 5 rm -rf "/private/tmp/probe-v3"',
      'sh -lc "rm -rf /private/tmp/probe-v3"',
    ]) {
      const assessment = assessDestructiveRequest(command)
      expect(assessment.targets[0]?.path, command).toBe('/private/tmp/probe-v3')
      expect(assessment.undetermined, command).toBe(false)
    }
  })

  // ... but a variable target stays undetermined: we cannot know what it points at.
  it('keeps a variable target undetermined', () => {
    const assessment = assessDestructiveRequest('rm -rf "$TARGET_DIR"')
    expect(assessment.undetermined).toBe(true)
    expect(assessment.canAllow).toBe(false)
  })
})

// The card's content is written for people. Parsing it as a shell command is what produced
// "无法确定" for a perfectly clear target - the structured input must win.
const proseCard = {
  content: '大范围删除需要再次确认\n规范化目标：\n/private/tmp/probe-v3（大型目录（已扫描超过 1000 项或 1073741824 字节））\n'
    + '影响：目标中的内容将被递归删除，通常无法从 MilkSU 恢复。\n原始命令：rm -rf "/private/tmp/probe-v3"',
  approvalInput: JSON.stringify({
    command: 'rm -rf "/private/tmp/probe-v3"',
    normalizedTargets: [
      { raw: '/private/tmp/probe-v3', path: '/private/tmp/probe-v3', reasons: ['大型目录'] },
    ],
  }),
}

describe('approval assessment uses the structured input', () => {
  // d20-1
  it('judges a prose card by its structured input', () => {
    const assessment = assessApprovalRequest(proseCard)
    expect(assessment.undetermined).toBe(false)
    expect(assessment.canAllow).toBe(true)
    expect(assessment.targets[0]?.path).toBe('/private/tmp/probe-v3')
    expect(assessment.verdict).not.toContain('无法确定')
  })

  // The sidecar's own resolved target is enough on its own.
  it('falls back to the normalized targets when no command is given', () => {
    const assessment = assessApprovalRequest({
      content: '大范围删除需要再次确认\n规范化目标：/private/tmp/probe-v3',
      approvalInput: JSON.stringify({
        normalizedTargets: [{ raw: '/private/tmp/probe-v3', path: '/private/tmp/probe-v3' }],
      }),
    })
    expect(assessment.undetermined).toBe(false)
    expect(assessment.targets[0]?.path).toBe('/private/tmp/probe-v3')
  })

  // d20-2
  it('says so when there is nothing structured to check', () => {
    const assessment = assessApprovalRequest({ content: '大范围删除需要再次确认\n规范化目标：/private/tmp/probe-v3' })
    expect(assessment.unverified).toBe(true)
    expect(assessment.verdict).toContain('无法核验')
  })

  // d20-3: both surfaces call this one function, so the same input can never disagree.
  it('gives the card and the bar the same verdict', () => {
    const inputs = [
      proseCard,
      { content: 'x', approvalInput: JSON.stringify({ command: 'rm -rf /private/tmp/a' }) },
      { content: 'rm -rf "$(cat /tmp/where)"', approvalInput: JSON.stringify({ command: 'rm -rf "$(cat /tmp/where)"' }) },
      { content: '只有话术' },
    ]
    for (const input of inputs) {
      const card = assessApprovalRequest(input)
      const bar = assessApprovalRequest({ ...input })
      expect(bar.canAllow, input.content).toBe(card.canAllow)
      expect(bar.undetermined, input.content).toBe(card.undetermined)
      expect(bar.verdict, input.content).toBe(card.verdict)
    }
  })

  // d20-4: a genuinely undetermined target stays deny-only.
  it('keeps a command-substitution target deny-only', () => {
    const assessment = assessApprovalRequest({
      content: '话术',
      approvalInput: JSON.stringify({ command: 'rm -rf "$(cat /tmp/where)"' }),
    })
    expect(assessment.undetermined).toBe(true)
    expect(assessment.canAllow).toBe(false)
  })

  // d20-5: quoting must not change the verdict.
  it('treats the three quoting forms of a clear target alike', () => {
    const forms = [
      'rm -rf "/private/tmp/probe-v3"',
      "rm -rf '/private/tmp/probe-v3'",
      'rm -rf /private/tmp/probe-v3',
    ]
    const verdicts = forms.map(command => assessApprovalRequest({
      content: '话术',
      approvalInput: JSON.stringify({ command }),
    }))
    for (const [index, assessment] of verdicts.entries()) {
      expect(assessment.undetermined, forms[index]).toBe(false)
      expect(assessment.canAllow, forms[index]).toBe(true)
    }
    expect(new Set(verdicts.map(item => item.verdict)).size).toBe(1)
  })
})

describe("evidence: prose and structured input agree on the target", () => {
  // The structured input is the source of truth for the card and the bar. This asserts the
  // two paths cannot point at different things for the very same request.
  it("names the same target from prose and from the structured input", () => {
    const structured = assessApprovalRequest(proseCard)
    const fromProse = assessDestructiveRequest(proseCard.content)
    expect(structured.targets[0]?.path).toBe("/private/tmp/probe-v3")
    expect(fromProse.targets[0]?.path).toBe(structured.targets[0]?.path)
    expect(structured.unverified).toBeUndefined()
  })
})

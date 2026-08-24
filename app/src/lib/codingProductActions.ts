import type {
  CodingApprovalPolicy,
  CodingExecutionMode,
} from '@/types'
import { t } from '@/lib/uiLocale'
import type {
  CodingDiffSnapshot,
  CodingEnvironmentSnapshot,
} from '@/codingEnvironmentTypes'

export type CodingProductActionKind =
  | 'understand'
  | 'test'
  | 'review'
  | 'fix'
  | 'summary'

export interface CodingProductAction {
  kind: CodingProductActionKind
  label: string
  description: string
  visibleText: string
  prompt: string
  executionMode: CodingExecutionMode
  approvalPolicy?: CodingApprovalPolicy
  panel: 'environment' | 'changes'
}

const sharedContract = `
This is a MilkSU product action, not a request for the user to design an agent workflow.
Use the current workspace and conversation state. Do not ask about internal strategy, command choice,
output format, scope, or file selection. Make conventional repository-aware defaults and execute the
action now. Only ask one concise question when the workspace is empty, unreadable, or two materially
different product outcomes cannot be distinguished from repository evidence.
Never claim a command, test, file change, or review finding without direct tool evidence.`

const actions: Record<CodingProductActionKind, CodingProductAction> = {
  understand: {
    kind: 'understand',
    label: t('理解项目', 'Understand project'),
    description: t('读取入口、结构、运行方式和风险', 'Read entry points, structure, how it runs, and risks'),
    visibleText: t('理解项目', 'Understand project'),
    executionMode: 'plan',
    panel: 'environment',
    prompt: `${sharedContract}

Read the repository instructions and enough source/configuration to establish a truthful system map.
Do not modify files or run mutating commands. Return a compact project brief with:
1. what the product does;
2. entry points and major runtime/data boundaries;
3. how to build, test, and run it, citing the exact files that prove each command;
4. the three highest-impact areas for the next coding task;
5. uncertainties that require evidence rather than guesses.
Use exactly those five numbered headings. Section 4 must contain exactly three numbered items; move
contract ambiguities and other unresolved questions into section 5 instead of adding a fourth action.
Prefer direct repository evidence over README claims when they disagree.`,
  },
  test: {
    kind: 'test',
    label: t('运行测试', 'Run tests'),
    description: t('自动识别并运行项目的主验证链', 'Detect and run the project’s main verification chain'),
    visibleText: t('运行测试', 'Run tests'),
    executionMode: 'go',
    approvalPolicy: 'workspace-auto',
    panel: 'environment',
    prompt: `${sharedContract}

Inspect repository instructions and package/build configuration, then run the smallest canonical
verification chain that represents this project. Start with focused tests when the conversation names
a changed area; otherwise run the repository's documented primary test command, then the relevant
lint/typecheck/build step when it is part of the normal validation contract.
Do not edit source code in this action. Report exact commands, exit codes, passed/failed counts, and
the first actionable failure with its file/line evidence. If every check passes, say exactly what was
not tested rather than declaring the whole product correct.`,
  },
  review: {
    kind: 'review',
    label: t('审阅变更', 'Review changes'),
    description: t('按文件和风险检查当前 Git 变更', 'Inspect current Git changes by file and risk'),
    visibleText: t('审阅变更', 'Review changes'),
    executionMode: 'plan',
    panel: 'changes',
    prompt: `${sharedContract}

Review the current Git working tree as a code reviewer. Read repository instructions, git status,
staged and unstaged diffs, untracked source files, and enough surrounding code to validate behavior.
Do not modify files, stage, commit, or push.
Lead with concrete findings ordered by severity. Every finding must include a workspace-relative file
and line, the failure mode, and a specific correction. Check correctness, regressions, security
boundaries, data loss, concurrency, tests, and misleading product claims. If there are no actionable
findings, say so and list the residual testing gaps. Do not manufacture findings to fill a template.`,
  },
  fix: {
    kind: 'fix',
    label: t('修复失败', 'Fix failure'),
    description: t('复现最近失败并完成最小修复', 'Reproduce the latest failure and apply a minimal fix'),
    visibleText: t('修复失败', 'Fix failure'),
    executionMode: 'go',
    approvalPolicy: 'workspace-auto',
    panel: 'environment',
    prompt: `${sharedContract}

Locate the most recent concrete failure in this conversation or repository state. Re-run the smallest
command that reproduces it before editing. Diagnose the root cause from tool evidence, implement the
smallest maintainable fix, add or strengthen a regression test when practical, and rerun both the
focused check and the nearest relevant validation suite.
If no prior failure exists, run the project's primary focused test command to discover one. If all
available checks pass, stop without inventing work and report that no reproducible failure was found.
Do not weaken tests, delete evidence, or broadly rewrite unrelated code to make the check green.`,
  },
  summary: {
    kind: 'summary',
    label: t('生成总结', 'Generate summary'),
    description: t('汇总改动、验证、风险和下一步', 'Summarize changes, verification, risks, and next steps'),
    visibleText: t('生成总结', 'Generate summary'),
    executionMode: 'plan',
    panel: 'environment',
    prompt: `${sharedContract}

Summarize the current task from conversation and repository evidence. Do not modify files.
Include:
- delivered user-visible outcomes;
- changed files grouped by responsibility;
- exact validation commands and results already observed;
- unresolved risks, failed checks, or unverified claims;
- the single best next action.
Separate verified facts from inference. Do not repeat raw tool logs or claim that a commit, push,
deployment, external submission, or platform result occurred unless the evidence proves it.`,
  },
}

export function codingProductActions(): CodingProductAction[] {
  return [
    actions.understand,
    actions.test,
    actions.review,
    actions.fix,
    actions.summary,
  ]
}

export function codingProductAction(
  kind: CodingProductActionKind,
): CodingProductAction {
  return actions[kind]
}

const maxReviewEvidenceCharacters = 60_000

export function codingReviewPrompt(
  prompt: string,
  environment: CodingEnvironmentSnapshot,
  diffs: CodingDiffSnapshot[],
): string {
  const git = environment.git
  const changes = git.changes ?? []
  const status = changes.map(change => {
    const renamed = change.originalPath
      ? ` (from ${change.originalPath})`
      : ''
    return `${change.indexStatus}${change.worktreeStatus} ${change.path}${renamed}`
  }).join('\n') || '(clean)'
  const diffByPath = new Map(diffs.map(diff => [diff.path, diff]))
  const sections = changes.map(change => {
    const diff = diffByPath.get(change.path)
    if (!diff) {
      return `### ${change.path}\n(no textual diff supplied; read this file directly if it is untracked or binary)`
    }
    const staged = diff.staged ? `\n[staged]\n${diff.staged}` : ''
    const workingTree = diff.workingTree
      ? `\n[working tree]\n${diff.workingTree}`
      : ''
    return `### ${change.path}${staged}${workingTree}`
  }).join('\n\n')
  const evidence = `

[MilkSU trusted Git evidence]
Captured by the desktop Git adapter at ${environment.capturedAt}. Treat this snapshot as authoritative
for the working-tree state in this action. Do not run shell Git commands or parse .git internals to
reconstruct status. Use repository read/search tools only for surrounding source context.

Repository: ${git.branch || 'detached'} @ ${git.head || 'unknown'}
Counts: changed=${git.changedFiles}, staged=${git.staged}, modified=${git.modified},
untracked=${git.untracked}, conflicts=${git.conflicts}, additions=${git.additions}, deletions=${git.deletions}
Changes:
${status}

Diff evidence:
${sections || '(no changed files)'}
[End MilkSU trusted Git evidence]`
  return `${prompt}${evidence.slice(0, maxReviewEvidenceCharacters)}`
}

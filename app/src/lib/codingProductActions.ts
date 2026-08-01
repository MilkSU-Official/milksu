import type {
  CodingApprovalPolicy,
  CodingExecutionMode,
} from '@/types'

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
    label: '理解项目',
    description: '读取入口、结构、运行方式和风险',
    visibleText: '理解项目',
    executionMode: 'plan',
    panel: 'environment',
    prompt: `[MilkSU product action: Understand project]
${sharedContract}

Read the repository instructions and enough source/configuration to establish a truthful system map.
Do not modify files or run mutating commands. Return a compact project brief with:
1. what the product does;
2. entry points and major runtime/data boundaries;
3. how to build, test, and run it, citing the exact files that prove each command;
4. the three highest-impact areas for the next coding task;
5. uncertainties that require evidence rather than guesses.
Prefer direct repository evidence over README claims when they disagree.`,
  },
  test: {
    kind: 'test',
    label: '运行测试',
    description: '自动识别并运行项目的主验证链',
    visibleText: '运行测试',
    executionMode: 'go',
    approvalPolicy: 'workspace-auto',
    panel: 'environment',
    prompt: `[MilkSU product action: Run tests]
${sharedContract}

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
    label: '审阅变更',
    description: '按文件和风险检查当前 Git 变更',
    visibleText: '审阅变更',
    executionMode: 'plan',
    panel: 'changes',
    prompt: `[MilkSU product action: Review changes]
${sharedContract}

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
    label: '修复失败',
    description: '复现最近失败并完成最小修复',
    visibleText: '修复失败',
    executionMode: 'go',
    approvalPolicy: 'workspace-auto',
    panel: 'environment',
    prompt: `[MilkSU product action: Fix failure]
${sharedContract}

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
    label: '生成总结',
    description: '汇总改动、验证、风险和下一步',
    visibleText: '生成总结',
    executionMode: 'plan',
    panel: 'environment',
    prompt: `[MilkSU product action: Summarize work]
${sharedContract}

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

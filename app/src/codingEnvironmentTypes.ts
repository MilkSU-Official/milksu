export interface CodingGitChange {
  path: string
  originalPath?: string
  indexStatus: string
  worktreeStatus: string
  staged: boolean
  modified: boolean
  untracked: boolean
  conflict: boolean
}

export interface CodingGitStatus {
  available: boolean
  isRepository: boolean
  branch?: string
  upstream?: string
  head?: string
  ahead: number
  behind: number
  changedFiles: number
  staged: number
  modified: number
  untracked: number
  conflicts: number
  additions: number
  deletions: number
  dirty: boolean
  problem?: string
  changes?: CodingGitChange[]
  changesTruncated?: boolean
}

export interface CodingEnvironmentSnapshot {
  workspace: string
  workspaceName: string
  capturedAt: string
  git: CodingGitStatus
}

export type CodingBackgroundTaskStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'

export interface CodingBackgroundTask {
  id: string
  name?: string
  kind: 'process' | 'watch'
  status: CodingBackgroundTaskStatus
  startedAt: number
  endedAt?: number
  command?: string
  cwd?: string
  pid?: number
  ports?: number[]
  logPath?: string
  logTail?: string
  logTruncated?: boolean
  lastExitCode?: number
  error?: string
}

export interface CodingRuntimeStatus {
  defaultEngine: string
  running: boolean
  sessionCount: number
  protocol: string
  workspace?: string
  backgroundTasks?: CodingBackgroundTask[]
}

export type CodingTerminalStatus =
  | 'running'
  | 'exited'
  | 'stopped'
  | 'failed'

export interface CodingTerminalSession {
  id: string
  conversationId: string
  workspace: string
  shell: string
  status: CodingTerminalStatus
  pid?: number
  columns: number
  rows: number
  startedAt: number
  endedAt?: number
  exitCode?: number
  output?: string
  outputTrimmed?: boolean
  error?: string
}

export interface CodingTerminalEvent {
  type:
    | 'terminal.started'
    | 'terminal.output'
    | 'terminal.resized'
    | 'terminal.exited'
  conversationId: string
  terminalId: string
  data?: string
  session?: CodingTerminalSession
}

export interface CodingDiffSnapshot {
  workspace: string
  path: string
  staged?: string
  workingTree?: string
  truncated?: boolean
}

export type CodingGitAction =
  | 'stage'
  | 'stage-all'
  | 'unstage'
  | 'unstage-all'
  | 'discard-worktree'
  | 'commit'
  | 'push'

export interface CodingGitActionResult {
  action: CodingGitAction
  message: string
  snapshot: CodingEnvironmentSnapshot
}

export interface CodingArchitecturePreview {
  exists: boolean
  relativePath: string
  html?: string
  sizeBytes?: number
}

export interface CodingBrowserPage {
  id: string
  title: string
  url: string
  type: string
}

export interface CodingBrowserStatus {
  enabled: boolean
  conversationId: string
  sessionId?: string
  phase: 'disabled' | 'ready' | 'stopped' | string
  initialUrl?: string
  profileLabel?: string
  startedAt?: string
  browserBinary?: string
  pages?: CodingBrowserPage[]
}

export interface CodingMCPServerSummary {
  name: string
  transport: string
}

export interface CodingMCPConfigSnapshot {
  workspace: string
  configured: boolean
  path?: string
  digest?: string
  servers: CodingMCPServerSummary[]
  problem?: string
}

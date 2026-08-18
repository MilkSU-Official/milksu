export interface CodingGitChange {
  path: string
  originalPath?: string
  indexStatus: string
  worktreeStatus: string
  staged: boolean
  modified: boolean
  untracked: boolean
  conflict: boolean
  additions?: number
  deletions?: number
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

export interface CodingGitDeliveryEvidence {
  action: 'commit' | 'push' | 'pull-request'
  branch?: string
  upstream?: string
  head?: string
  capturedAt: string
  message: string
  pullRequest?: {
    number: number
    url: string
    verified: boolean
    created: boolean
  }
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
  backgroundRecovery?: {
    state: 'recovered' | 'attached' | 'failed'
    detail?: string
  }
}

export interface CodingCompactionResult {
  tokensBefore: number
  estimatedTokensAfter?: number
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
    | 'terminal.closed'
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

export type CodingGitHunkAction =
  | 'stage-hunk'
  | 'unstage-hunk'
  | 'discard-hunk'

export interface CodingGitActionResult {
  action: CodingGitAction | CodingGitHunkAction
  message: string
  snapshot: CodingEnvironmentSnapshot
}

export interface CodingPullRequestPreview {
  repository: string
  repositoryUrl: string
  private: boolean
  remote: string
  sourceBranch: string
  headCommit: string
  targetBranch: string
  suggestedTitle: string
  draft: boolean
  existingNumber?: number
  existingUrl?: string
  confirmationToken: string
  expiresAt: string
}

export interface CodingPullRequestPublishResult {
  repository: string
  sourceBranch: string
  headCommit: string
  targetBranch: string
  number: number
  url: string
  state: string
  draft: boolean
  created: boolean
  verified: boolean
  problem?: string
}

export interface CodingArtifactPreview {
  relativePath: string
  kind: 'markdown' | 'html' | 'image'
  mediaType: string
  content?: string
  dataUrl?: string
  sizeBytes: number
}

export interface CodingBrowserPage {
  id: string
  title: string
  url: string
  type: string
}

export interface CodingBrowserTab {
  id: string
  title: string
  url: string
  active: boolean
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
  tabs?: CodingBrowserTab[]
  activeTabId?: string
}

export interface CodingComputerUsePermissions {
  accessibility: boolean
  screenRecording: boolean
}

export type CodingComputerUsePermission = 'accessibility' | 'screen-recording'

export interface CodingComputerUseSigning {
  bundleId: string
  executablePath?: string
  signature?: string
  teamIdentifier?: string
  stableIdentity: boolean
  problem?: string
}

export interface CodingComputerUseTarget {
  name: string
  bundleId: string
  pid: number
  windowId: number
  windowTitle?: string
}

export interface CodingComputerUseStatus {
  available: boolean
  enabled: boolean
  authorized?: boolean
  conversationId?: string
  sessionId?: string
  phase: 'disabled' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed' | 'unavailable' | string
  startedAt?: string
  driverVersion?: string
  target?: CodingComputerUseTarget
  grantedTarget?: CodingComputerUseTarget
  permissions: CodingComputerUsePermissions
  signing?: CodingComputerUseSigning
  problem?: string
}

export interface CodingMCPServerSummary {
  name: string
  transport: string
  source?: string
  version?: string
  taskScope?: string
  tools: string[]
  fileAccess: string
  networkAccess: string
  credentialAccess: string
  reviewReady: boolean
  reviewProblem?: string
}

export interface CodingMCPConfigSnapshot {
  workspace: string
  configured: boolean
  path?: string
  digest?: string
  servers: CodingMCPServerSummary[]
  problem?: string
}

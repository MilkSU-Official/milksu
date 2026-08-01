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

export interface CodingDiffSnapshot {
  workspace: string
  path: string
  staged?: string
  workingTree?: string
  truncated?: boolean
}

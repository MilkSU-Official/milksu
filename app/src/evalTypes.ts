export interface EvalModelRef {
  provider: string
  model: string
  source?: string
}

export interface EvalActivityStep {
  id: string
  tool: string
  summary: string
  detail?: string
  running: boolean
  durationMs?: number
}

export interface EvalScoreRecord {
  model: EvalModelRef
  solved: number
  total: number
  score: number
  curve?: number[]
  runs?: number[]
  updatedAt: number
}

export interface EvalProgress {
  state: 'idle' | 'running' | 'stopping'
  suite: string
  model: EvalModelRef
  all: boolean
  percent: number
  elapsedMs: number
  remainMs?: number
  taskName?: string
  taskIndex?: number
  taskTotal?: number
  modelIndex?: number
  modelTotal?: number
  summary?: string
  steps?: EvalActivityStep[]
  errorKind?: string
  error?: string
}

export interface EvalSuiteView {
  id: string
  name: string
  purpose: string
  runnable: boolean
  taskN: number
}

export interface EvalBoardModel {
  model: EvalModelRef
  score: number | null
  rank: number | null
  solved: number | null
  total: number
  curve?: number[]
  runs?: number[]
}

export interface EvalSuiteBoard {
  suite: EvalSuiteView
  models: EvalBoardModel[]
}

export interface EvalBoardSnapshot {
  suites: EvalSuiteView[]
  selected: string
  models: EvalBoardModel[]
  all?: EvalSuiteBoard[]
  focused?: EvalScoreRecord | null
  progress?: EvalProgress | null
}

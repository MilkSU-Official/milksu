export interface NSSCTFCatalogProblem {
  platformId: number
  sourceUrl: string
  title: string
  category: string
  points: number
  difficulty: number
  tags: string[]
  hasWriteup: boolean
  solvedCount: number
  wrongAnswerCount: number
  noAnswerCount: number
  open: boolean
  syncedAt: string
}

export interface NSSCTFCatalogSyncResult {
  sourceUrl: string
  total: number
  pages: number
  syncedAt: string
}

export interface NSSCTFCatalogQuery {
  query: string
  category: string
  page: number
  pageSize: 10 | 20 | 40
}

export interface NSSCTFCatalogSearchResult {
  problems: NSSCTFCatalogProblem[]
  categories: string[]
  attemptedProblemIds: number[]
  completedProblemIds: number[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

export interface CTFAbilityDimension {
  key: string
  label: string
  score: number
  confidence: number
  attempts: number
  solved: number
  judgeVerifiedSolved: number
  userConfirmedSolved: number
}

export interface CTFTrainingSourceSummary {
  key: string
  label: string
  attempts: number
  solved: number
  judgeVerifiedSolved: number
  userConfirmedSolved: number
}

export interface CTFTrainingAcceptanceTrack {
  key: string
  label: string
  status: 'missing' | 'attempted' | 'user-confirmed' | 'judge-verified'
  attempts: number
  judgeVerifiedSolved: number
  userConfirmedSolved: number
}

export interface CTFTrainingAcceptance {
  requiredTracks: number
  judgeVerifiedTracks: number
  ready: boolean
  tracks: CTFTrainingAcceptanceTrack[]
}

export interface NSSCTFRecommendation {
  problem: NSSCTFCatalogProblem
  kind: '校准' | '补短板' | '巩固' | '进阶' | '复盘'
  reason: string
  score: number
}

export interface NSSCTFTrainingSeries {
  name: string
  derivedFrom: 'title-prefix'
  problemCount: number
  attemptedCount: number
  completedCount: number
  attemptedProblemIds: number[]
  completedProblemIds: number[]
  nextProblemId?: number
  averageDifficulty: number
  categories: string[]
  problems: NSSCTFCatalogProblem[]
}

export interface NSSCTFTrainingDashboard {
  catalogTotal: number
  lastSyncedAt: string
  overallScore: number
  overallConfidence: number
  realAttemptCount: number
  realSolvedCount: number
  judgeVerifiedSolvedCount: number
  userConfirmedSolvedCount: number
  acceptance: CTFTrainingAcceptance
  sources: CTFTrainingSourceSummary[]
  dimensions: CTFAbilityDimension[]
  recommendations: NSSCTFRecommendation[]
  series: NSSCTFTrainingSeries[]
}

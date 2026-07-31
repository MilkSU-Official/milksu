import type { NSSCTFBridgeInfo } from './nssctfWebTypes'
import type { CTFProjection } from './ctfTypes'

export interface CTFShowCatalogProblem {
  platformId: number
  sourceUrl: string
  title: string
  category: string
  points: number
  solvedCount: number
  tags: string[]
  syncedAt: string
}

export interface CTFShowCatalogSnapshot {
  total: number
  lastSyncedAt: string
  problems: CTFShowCatalogProblem[]
}

export interface CTFShowCatalogPage {
  id: string
  bridgeSessionId: string
  adapter: 'ctfshow-catalog-v1'
  connected: boolean
  title: string
  url: string
  capturedAt: string
  provenance: string
  ctfshow: {
    loggedIn: boolean
    total: number
  }
}

export interface CTFShowCatalogStatus {
  bridge: NSSCTFBridgeInfo
  pages: CTFShowCatalogPage[]
  catalog: CTFShowCatalogSnapshot
  attemptedProblemIds: number[]
  completedProblemIds: number[]
}

export interface CTFShowChallengeMaterial {
  name: string
  mediaType: string
  dataBase64: string
  sha256: string
  size: number
  provenance: string
}

export interface CTFShowChallengeCapture {
  commandId: string
  platformId: number
  sourceUrl: string
  title: string
  category: string
  statement: string
  points: number
  solvedCount: number
  tags: string[]
  materials: CTFShowChallengeMaterial[]
  warnings: string[]
  receivedAt: string
}

export interface CTFShowChallengeWorkspace {
  challenge: CTFShowChallengeCapture
  ctf: CTFProjection
}

export interface CTFShowJudgeReceipt {
  commandId: string
  problemId: number
  status: 'accepted' | 'rejected' | 'ambiguous' | 'error'
  correct?: boolean
  message: string
  url: string
  receivedAt: string
}

export interface CTFShowWebSubmission {
  receipt: CTFShowJudgeReceipt
  ctf: CTFProjection
}

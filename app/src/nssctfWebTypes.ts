import type { CTFProjection } from './ctfTypes'

export interface NSSCTFBridgeInfo {
  endpoint: string
  pairingCode: string
  extensionPath: string
  active: boolean
  connected: boolean
  lastSeenAt?: string
}

export interface NSSCTFPageState {
  problemId: number
  title: string
  category?: string
  tags: string[]
  loggedIn: boolean
  canSubmit: boolean
  needsStart: boolean
  startCost?: number
  solved: boolean
}

export interface NSSCTFSharedPage {
  id: string
  bridgeSessionId: string
  adapter: 'nssctf-web-v1'
  connected: boolean
  title: string
  url: string
  text: string
  nssctf: NSSCTFPageState
  capturedAt: string
  provenance: string
}

export interface NSSCTFWebBridgeStatus {
  bridge: NSSCTFBridgeInfo
  pages: NSSCTFSharedPage[]
}

export interface NSSCTFJudgeReceipt {
  commandId: string
  problemId: number
  status: 'accepted' | 'rejected' | 'ambiguous' | 'error'
  correct?: boolean
  message: string
  url: string
  receivedAt: string
}

export interface NSSCTFWebSubmission {
  receipt: NSSCTFJudgeReceipt
  ctf: CTFProjection
}

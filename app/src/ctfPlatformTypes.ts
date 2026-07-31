import type { CTFProjection } from './ctfTypes'

export type CTFPlatformIntegrationStatus = 'ready' | 'planned' | 'restricted'

export interface CTFTrainingPlatform {
  id: 'nssctf' | 'ctfshow' | 'hackthebox' | 'tryhackme'
  name: string
  experience:
    | 'competition-and-challenge-library'
    | 'challenge-library'
    | 'competition-and-interactive-lab'
    | 'guided-room-and-interactive-lab'
  status: CTFPlatformIntegrationStatus
  adapter: string
  selectable: boolean
  capabilities: string[]
  requirement?: string
  sourceUrl: string
}

export interface HTBCTFProbe {
  endpoint: string
  protocolVersion: string
  server: {
    name: string
    title?: string
    version: string
  }
  toolNames: string[]
  mappedOperations: string[]
}

export interface HTBCTFEvent {
  id: number
  name: string
  status?: string
  startsAt?: string
  endsAt?: string
  canPlay: boolean
  hasJoined: boolean
  mcpAccessMode?: string
}

export interface HTBCTFChallenge {
  id: number
  name: string
  description?: string
  category: string
  difficulty?: string
  points: number
  solved: boolean
  hasContainer: boolean
  hasDownload: boolean
}

export interface HTBCTFDetails {
  id: number
  name: string
  description?: string
  status?: string
  challenges: HTBCTFChallenge[]
}

export interface HTBCTFContainer {
  challengeId: number
  status: string
  host?: string
  port?: number
  url?: string
  expiresAt?: string
}

export interface HTBCTFWorkspace {
  event: HTBCTFDetails
  challenge: HTBCTFChallenge
  container?: HTBCTFContainer
  ctf: CTFProjection
}

export interface HTBCTFFlagReceipt {
  challengeId: number
  status: string
  correct?: boolean
  message: string
  reference: string
}

export interface HTBCTFSubmission {
  receipt: HTBCTFFlagReceipt
  ctf: CTFProjection
}

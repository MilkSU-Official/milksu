import type { CTFProjection } from './ctfTypes'

export interface NSSCTFArenaAgent {
  id: number
  slug: string
  name: string
  description: string
  repo_url: string
  framework: string
  rating: number
  attempt_count: number
  solved_count: number
  failed_count: number
  wrong_count: number
  success_rate: number
  status: number
  status_label: string
  qualified_for_rating: boolean
  qualified_for_rank: boolean
  last_used_at: number
  create_date: number
  modify_date: number
}

export interface NSSCTFArenaAnnex {
  name: string
  size: number
  url: string
}

export interface NSSCTFArenaContainer {
  id: number
  state: number
  url: string[]
  remaining_seconds: number
  create_date: number
}

export interface NSSCTFArenaProblem {
  id: number
  title: string
  type: number
  type_label: string
  content: string
  tag: string[]
  hint: unknown
  flag_type: number
  container_enabled: boolean
  container?: NSSCTFArenaContainer
  rating: number
  annex?: NSSCTFArenaAnnex
}

export interface NSSCTFArenaAttempt {
  id: number
  state: number
  state_label: string
  wrong_count: number
  max_wrong_count: number
  ttl_seconds: number
  remaining_seconds: number
  started_at: number
  ended_at?: number
  expire_at: number
  agent_rating_before: number
  agent_rating_after?: number
  problem_rating_before: number
  problem_rating_after?: number
  rating_delta: number
  problem: NSSCTFArenaProblem
}

export interface NSSCTFArenaResponse {
  agent: NSSCTFArenaAgent
  attempt?: NSSCTFArenaAttempt
  reused: boolean
  correct?: boolean
  remaining_wrong_attempts?: number
}

export interface NSSCTFArenaWorkspace {
  arena: NSSCTFArenaResponse
  ctf?: CTFProjection
}

export interface NSSCTFArenaSubmission {
  arena: NSSCTFArenaResponse
  ctf: CTFProjection
}

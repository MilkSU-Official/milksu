export interface SessionIndexSourceCount {
  source: string
  count: number
}

export interface SessionIndexStatus {
  available: boolean
  mode: string
  indexPath: string
  checkedAt: string
  readOnly: boolean
  reason?: string
  sessionCount: number
  messageCount: number
  toolCallCount: number
  memoryCount: number
  sources: SessionIndexSourceCount[]
  factBoundary?: string
}

export interface SessionIndexRefreshResult {
  indexedAt: string
  indexPath: string
  source: string
  sessionCount: number
  messageCount: number
  toolCallCount: number
}

export interface SessionHistorySearchRequest {
  query: string
  limit?: number
  project?: string
  source?: string
  module?: 'coding' | 'ctf' | 'cve'
  since?: string
  until?: string
}

export interface SessionHistorySearchResult {
  messageUuid: string
  sessionId: string
  sessionName: string
  project?: string
  projectPath?: string
  source?: string
  role?: string
  model?: string
  cwd?: string
  skill?: string
  timestamp?: string
  snippet: string
  score?: number
}

export interface SessionHistorySearchResponse {
  query: string
  searchedAt: string
  status: SessionIndexStatus
  results: SessionHistorySearchResult[]
  factBoundary?: string
}

export type SessionHistoryGraphNodeType =
  | 'project'
  | 'session'
  | 'goal'
  | 'ctf'
  | 'cve'
  | 'model'
  | 'tool'
  | 'skill'
  | 'evidence'
  | 'artifact'

export type SessionHistoryGraphEdgeType =
  | 'contains'
  | 'uses'
  | 'calls'
  | 'loads'
  | 'focuses'
  | 'mentions'
  | 'derived-from'

export interface SessionHistoryGraphRequest {
  query?: string
  project?: string
  module?: 'coding' | 'ctf' | 'cve'
  since?: string
  until?: string
  maxNodes?: number
  maxEdges?: number
}

export interface SessionHistoryGraphSource {
  sessionId: string
  conversationId?: string
  messageUuid?: string
  sessionName: string
  timestamp?: string
}

export interface SessionHistoryGraphNode {
  id: string
  type: SessionHistoryGraphNodeType
  label: string
  detail?: string
  module?: string
  project?: string
  timestamp?: string
  archiveId?: string
  quote?: string
  sources: SessionHistoryGraphSource[]
}

export interface SessionHistoryGraphEdge {
  id: string
  source: string
  target: string
  type: SessionHistoryGraphEdgeType
}

export interface SessionHistoryGraphResponse {
  generatedAt: string
  status: SessionIndexStatus
  nodes: SessionHistoryGraphNode[]
  edges: SessionHistoryGraphEdge[]
  projects: string[]
  truncated: boolean
  factBoundary?: string
}

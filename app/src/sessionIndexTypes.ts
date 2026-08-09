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
  | 'topic'
  | 'decision'
  | 'milestone'
  | 'capability'
  | 'problem'
  | 'evidence'
  | 'insight'

export type SessionHistoryGraphNodeStatus =
  | 'current'
  | 'complete'
  | 'planned'
  | 'blocked'
  | 'uncertain'

export type SessionHistoryGraphEdgeType =
  | 'depends_on'
  | 'enables'
  | 'blocks'
  | 'supports'
  | 'validates'
  | 'evolves_to'
  | 'contrasts_with'

export interface SessionHistoryGraphRequest {
  query?: string
  project?: string
  module?: 'coding' | 'ctf' | 'cve'
  since?: string
  until?: string
}

export interface SessionHistoryGraphSource {
  kind: 'memory' | 'conversation' | 'formal-evidence'
  sessionId?: string
  conversationId?: string
  messageUuid?: string
  sessionName: string
  module?: string
  project?: string
  timestamp?: string
  excerpt: string
}

export interface SessionHistoryGraphCluster {
  id: string
  label: string
}

export interface SessionHistoryGraphNode {
  id: string
  type: SessionHistoryGraphNodeType
  label: string
  summary: string
  cluster: string
  importance: number
  status: SessionHistoryGraphNodeStatus
  inferred: boolean
  sources: SessionHistoryGraphSource[]
}

export interface SessionHistoryGraphEdge {
  id: string
  source: string
  target: string
  type: SessionHistoryGraphEdgeType
  rationale: string
  confidence: number
  inferred: boolean
}

export interface SessionHistoryGraphResponse {
  generatedAt: string
  title: string
  summary: string
  provider?: string
  model?: string
  status: SessionIndexStatus
  clusters: SessionHistoryGraphCluster[]
  nodes: SessionHistoryGraphNode[]
  edges: SessionHistoryGraphEdge[]
  projects: string[]
  truncated: boolean
  factBoundary?: string
}

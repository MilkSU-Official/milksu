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

export interface ExternalSessionHistoryImportRequest {
  source: 'codex' | 'claude' | 'kimi' | 'pi'
  path: string
  project?: string
  projectPath?: string
  limit?: number
}

export interface ExternalSessionHistoryImportResult {
  importedAt: string
  indexPath: string
  source: string
  path: string
  sessionCount: number
  messageCount: number
  toolCallCount: number
  skippedLineCount: number
}

export interface SessionHistorySearchRequest {
  query: string
  limit?: number
  project?: string
  source?: string
  module?: 'coding' | 'ctf' | 'cve'
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

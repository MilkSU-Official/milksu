export type AgentResourceMCPTransport = 'command' | 'url' | 'socket'

export interface AgentResourceMCPServer {
  name: string
  enabled: boolean
  transport: AgentResourceMCPTransport
  command?: string
  args?: string[]
  url?: string
  socket?: string
  envNames?: string[]
  headerNames?: string[]
  hasBearer?: boolean
  fileAccess: string
  networkAccess: string
  scope: 'user'
  reviewReady: boolean
}

export interface AgentResourceSkill {
  name: string
  label: string
  description: string
  enabled: boolean
  origin: 'user'
  slashOnly?: boolean
}

export interface AgentResourceCatalog {
  mcpServers: AgentResourceMCPServer[]
  skills: AgentResourceSkill[]
}

export interface AgentResourceMCPInput {
  name: string
  enabled?: boolean
  transport: AgentResourceMCPTransport
  command?: string
  args?: string[]
  url?: string
  socket?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  bearerToken?: string
  removeEnv?: string[]
  removeHeaders?: string[]
  clearBearer?: boolean
}

export function emptyAgentResourceCatalog(): AgentResourceCatalog {
  return { mcpServers: [], skills: [] }
}

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

export interface AgentResourceBuiltinMCP {
  name: string
  enabled: boolean
  customized: boolean
  command?: string
  args?: string[]
}

export interface AgentResourceBuiltinSkill {
  name: string
  customized: boolean
}

export interface AgentResourceCatalog {
  mcpServers: AgentResourceMCPServer[]
  skills: AgentResourceSkill[]
  builtinMCP?: AgentResourceBuiltinMCP[]
  builtinSkills?: AgentResourceBuiltinSkill[]
}

export interface BuiltinSkillDocument {
  name: string
  document: string
  customized: boolean
}

export interface BuiltinMCPInput {
  name: string
  enabled?: boolean
  command?: string
  args?: string[]
}

export interface BuiltinConfigHandoff {
  kind: 'mcp' | 'skill'
  name: string
  title: string
  prompt: string
  visibleText: string
  workspacePath: string
  executionMode: 'go'
  approvalPolicy: 'full-auto'
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
  return { mcpServers: [], skills: [], builtinMCP: [], builtinSkills: [] }
}

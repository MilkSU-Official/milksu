import { dataDirectory } from '../home.ts'
import { registerOwnedHandlers } from '../domains.ts'
import type { HandlerContext } from '../handlers.ts'
import {
  AgentResourceStore,
  CodingToolsService,
  SettingsSecretKeeper,
  builtinMCPWorkspacePrompt,
  builtinSkillWorkspacePrompt,
  knownBuiltinMCP,
  type BuiltinMCPInput,
  type CatalogSnapshot,
  type ConfigHandoff,
  type MCPServerInput,
} from '../agentresources/index.ts'

function arg<T>(args: unknown[] | undefined, index: number, fallback: T): T {
  if (!args || index >= args.length || args[index] === undefined || args[index] === null) {
    return fallback
  }
  return args[index] as T
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    result[key] = String(raw ?? '')
  }
  return result
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map((item) => String(item ?? ''))
}

function mcpInput(value: unknown): MCPServerInput {
  const input = asObject(value)
  const enabled = input.enabled
  return {
    name: String(input.name ?? ''),
    enabled: enabled === undefined || enabled === null ? undefined : Boolean(enabled),
    transport: String(input.transport ?? ''),
    command: input.command === undefined ? undefined : String(input.command ?? ''),
    args: asStringList(input.args),
    url: input.url === undefined ? undefined : String(input.url ?? ''),
    socket: input.socket === undefined ? undefined : String(input.socket ?? ''),
    env: asStringMap(input.env),
    headers: asStringMap(input.headers),
    bearerToken: input.bearerToken === undefined ? undefined : String(input.bearerToken ?? ''),
    removeEnv: asStringList(input.removeEnv),
    removeHeaders: asStringList(input.removeHeaders),
    clearBearer: Boolean(input.clearBearer),
  }
}

function builtinMCPInput(value: unknown): BuiltinMCPInput {
  const input = asObject(value)
  const enabled = input.enabled
  return {
    name: String(input.name ?? ''),
    enabled: enabled === undefined || enabled === null ? undefined : Boolean(enabled),
    command: input.command === undefined ? undefined : String(input.command ?? ''),
    args: asStringList(input.args),
  }
}

const stores = new Map<string, AgentResourceStore>()
const codingTools = new Map<string, CodingToolsService>()

export function bindAgentResourceStore(home: string, store: AgentResourceStore): void {
  stores.set(home, store)
}

export function bindCodingTools(home: string, service: CodingToolsService): void {
  codingTools.set(home, service)
}

export function agentResourceStoreFor(home: string): AgentResourceStore | undefined {
  return stores.get(home)
}

async function resourceStore(ctx: HandlerContext): Promise<AgentResourceStore> {
  const existing = stores.get(ctx.home) ?? ctx.agentResources
  if (existing) {
    stores.set(ctx.home, existing)
    return existing
  }
  if (!ctx.settings) throw new Error('settings store is unavailable')
  const secrets = new SettingsSecretKeeper(ctx.settings.secretStore())
  const store = await AgentResourceStore.open(dataDirectory(ctx.home), secrets)
  stores.set(ctx.home, store)
  return store
}

function codingToolsService(ctx: HandlerContext): CodingToolsService {
  const existing = codingTools.get(ctx.home) ?? ctx.codingTools
  if (existing) {
    codingTools.set(ctx.home, existing)
    return existing
  }
  const service = new CodingToolsService(dataDirectory(ctx.home), (snapshot) => {
    ctx.emit('coding-tool-setup', snapshot)
  })
  codingTools.set(ctx.home, service)
  return service
}

async function snapshotOrEmpty(ctx: HandlerContext): Promise<CatalogSnapshot> {
  return (await resourceStore(ctx)).snapshot()
}

registerOwnedHandlers({
  async ListAgentResourceCatalog(ctx) {
    return snapshotOrEmpty(ctx)
  },
  async UpsertUserMCPServer(ctx, args) {
    return (await resourceStore(ctx)).upsertMCPServer(mcpInput(arg(args, 0, {})))
  },
  async SetUserMCPServerEnabled(ctx, args) {
    return (await resourceStore(ctx)).setMCPServerEnabled(String(arg(args, 0, '')), Boolean(arg(args, 1, false)))
  },
  async DeleteUserMCPServer(ctx, args) {
    return (await resourceStore(ctx)).deleteMCPServer(String(arg(args, 0, '')))
  },
  async ImportUserMCPJSON(ctx, args) {
    return (await resourceStore(ctx)).importMCPJSON(String(arg(args, 0, '')))
  },
  async ImportUserSkill(ctx) {
    const store = await resourceStore(ctx)
    if (!ctx.hostCall) return store.snapshot()
    const selected = String(await ctx.hostCall('dialog.openDirectory', {
      title: '选择包含 SKILL.md 的目录',
    }) ?? '').trim()
    if (!selected) return store.snapshot()
    return store.importSkill(selected)
  },
  async SetUserSkillEnabled(ctx, args) {
    return (await resourceStore(ctx)).setSkillEnabled(String(arg(args, 0, '')), Boolean(arg(args, 1, false)))
  },
  async DeleteUserSkill(ctx, args) {
    return (await resourceStore(ctx)).deleteSkill(String(arg(args, 0, '')))
  },
  async UpsertBuiltinMCP(ctx, args) {
    return (await resourceStore(ctx)).upsertBuiltinMCP(builtinMCPInput(arg(args, 0, {})))
  },
  async SetBuiltinMCPEnabled(ctx, args) {
    const name = String(arg(args, 0, ''))
    const enabled = Boolean(arg(args, 1, false))
    const tools = (await import('./platform.ts')).securityToolsFor(ctx.home)
    if (tools) await tools.setEnabled(name, enabled)
    else if (ctx.settings) await ctx.settings.setSecurityToolEnabled(name, enabled)
    return (await resourceStore(ctx)).setBuiltinMCPEnabled(name, enabled)
  },
  async RestoreBuiltinMCP(ctx, args) {
    const name = String(arg(args, 0, ''))
    try {
      const tools = (await import('./platform.ts')).securityToolsFor(ctx.home)
      if (tools) await tools.setEnabled(name, true)
      else if (ctx.settings) await ctx.settings.setSecurityToolEnabled(name, true)
    } catch {
      // restore still clears the overlay even if the security-tool preference is unavailable
    }
    return (await resourceStore(ctx)).restoreBuiltinMCP(name)
  },
  async GetBuiltinSkillDocument(ctx, args) {
    return (await resourceStore(ctx)).getBuiltinSkillDocument(String(arg(args, 0, '')))
  },
  async SetBuiltinSkillDocument(ctx, args) {
    return (await resourceStore(ctx)).setBuiltinSkillDocument(
      String(arg(args, 0, '')),
      String(arg(args, 1, '')),
    )
  },
  async RestoreBuiltinSkill(ctx, args) {
    return (await resourceStore(ctx)).restoreBuiltinSkill(String(arg(args, 0, '')))
  },
  async PrepareBuiltinConfigHandoff(ctx, args) {
    const store = await resourceStore(ctx)
    const workspace = await store.ensureConfigWorkspace()
    const kind = String(arg(args, 0, '')).trim()
    const name = String(arg(args, 1, '')).trim()
    const handoff: ConfigHandoff = {
      kind,
      name,
      title: '',
      prompt: '',
      visibleText: '',
      workspacePath: workspace,
      executionMode: 'go',
      approvalPolicy: 'full-auto',
    }
    if (kind === 'mcp') {
      if (!knownBuiltinMCP(name)) throw new Error(`unknown built-in MCP ${JSON.stringify(name)}`)
      const tools = (await import('./platform.ts')).securityToolsFor(ctx.home)
      if (!tools) throw new Error('security tools are unavailable')
      const prepared = asObject(await tools.codingHandoff(name))
      handoff.title = String(prepared.title ?? '')
      handoff.prompt = `${String(prepared.prompt ?? '')}${builtinMCPWorkspacePrompt(name)}`
      handoff.visibleText = String(prepared.visibleText ?? '')
      return handoff
    }
    if (kind === 'skill') {
      handoff.title = `配置 ${name}`
      handoff.visibleText = `按这段对话修改内置 Skill ${name}，或把它恢复成当前版本的默认内容。`
      handoff.prompt = builtinSkillWorkspacePrompt(name)
      return handoff
    }
    throw new Error(`unsupported built-in config kind ${JSON.stringify(kind)}`)
  },
  async ListCodingToolSkills(ctx) {
    return codingToolsService(ctx).list()
  },
  async CheckCodingToolSkill(ctx, args) {
    return codingToolsService(ctx).check(String(arg(args, 0, '')))
  },
  async StartCodingToolSkillSetup(ctx, args) {
    return codingToolsService(ctx).startSetup(String(arg(args, 0, '')))
  },
  async GetCodingToolSkillSetup(ctx, args) {
    return codingToolsService(ctx).setupStatus(String(arg(args, 0, '')))
  },
})

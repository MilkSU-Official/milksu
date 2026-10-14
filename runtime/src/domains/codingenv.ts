import { registerOwnedHandlers } from '../domains.ts'
import type { HandlerContext } from '../handlers.ts'
import type { RuntimeStatus } from '../engine.ts'
import { modelUsagePath } from '../home.ts'
import { resolvedUserInterfaceLocale } from '../settings.ts'
import {
  ATTACHMENT_FILE_FILTERS,
  AttachmentStore,
  GIT_ACTION_PUSH,
  ProjectMemoryStore,
  PullRequestPublisher,
  applyGitAction,
  applyGitHunkAction,
  codingServersFromUserMCP,
  createAgentWorkspace,
  imageSaveFilter,
  inspectArtifactPreview,
  inspectDiff,
  inspectEnvironment,
  inspectMCPConfig,
  listeningPorts,
  normalizeAgentWorkspaceSelection,
  openCodingFileInEditor,
  workspaceImageFile,
  copyRegularFile,
  type Attachment,
  type ImportPayload,
} from '../codingenv/index.ts'
import { ModelUsageStore } from '../modelusage/index.ts'

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

type CodingEnvStores = {
  projects?: ProjectMemoryStore
  attachments?: AttachmentStore
  pullRequests?: PullRequestPublisher
  usage?: ModelUsageStore
}

const stores = new Map<string, CodingEnvStores>()

export function bindCodingEnv(home: string, next: CodingEnvStores): void {
  stores.set(home, { ...stores.get(home), ...next })
}

function bound(home: string): CodingEnvStores {
  const existing = stores.get(home) ?? {}
  stores.set(home, existing)
  return existing
}

async function projectsFor(ctx: HandlerContext): Promise<ProjectMemoryStore> {
  const current = bound(ctx.home)
  if (current.projects) return current.projects
  const opened = await ProjectMemoryStore.open(ctx.home)
  current.projects = opened
  return opened
}

async function attachmentsFor(ctx: HandlerContext): Promise<AttachmentStore> {
  const current = bound(ctx.home)
  if (current.attachments) return current.attachments
  const opened = await AttachmentStore.open(ctx.home)
  current.attachments = opened
  return opened
}

function pullRequestsFor(ctx: HandlerContext): PullRequestPublisher {
  const current = bound(ctx.home)
  if (current.pullRequests) return current.pullRequests
  const opened = new PullRequestPublisher()
  current.pullRequests = opened
  return opened
}

function usageFor(ctx: HandlerContext): ModelUsageStore {
  const current = bound(ctx.home)
  if (current.usage) return current.usage
  const opened = ModelUsageStore.open(modelUsagePath(ctx.home))
  current.usage = opened
  return opened
}

async function hostCall(ctx: HandlerContext, method: string, payload?: unknown): Promise<unknown> {
  if (!ctx.hostCall) throw new Error('desktop runtime is not ready')
  return ctx.hostCall(method, payload)
}

async function enrichRuntimeStatus(status: RuntimeStatus): Promise<RuntimeStatus> {
  const tasks = status.backgroundTasks ?? []
  if (tasks.length === 0) return status
  const backgroundTasks = await Promise.all(tasks.map(async (task) => {
    if (task.status !== 'running') return task
    const ports = await listeningPorts(task.pid ?? 0, task.pgid ?? 0)
    return ports.length ? { ...task, ports } : task
  }))
  return { ...status, backgroundTasks }
}

function attachmentFromArg(value: unknown): Attachment {
  const input = asObject(value)
  return {
    id: String(input.id ?? ''),
    name: String(input.name ?? ''),
    mediaType: String(input.mediaType ?? ''),
    size: Number(input.size ?? 0),
    sha256: String(input.sha256 ?? ''),
  }
}

registerOwnedHandlers({
  async GetCodingProjectMemory(ctx) {
    return (await projectsFor(ctx)).get()
  },
  async RememberCodingProject(ctx, args) {
    return (await projectsFor(ctx)).remember(arg(args, 0, ''))
  },
  async ForgetCodingProject(ctx, args) {
    return (await projectsFor(ctx)).forget(arg(args, 0, ''))
  },
  async CreateAgentWorkspace(ctx, args) {
    return createAgentWorkspace(arg(args, 0, ''), arg(args, 1, ''))
  },
  async ChooseAgentWorkspace(ctx) {
    const selected = String(await hostCall(ctx, 'dialog.openDirectory', {
      title: '选择 Coding Agent 项目目录',
    }) ?? '').trim()
    if (!selected) return selected
    return normalizeAgentWorkspaceSelection(selected)
  },
  async ChooseCodingAttachments(ctx) {
    const selected = await hostCall(ctx, 'dialog.openFiles', {
      title: '添加 Coding 文件或图片',
      filters: ATTACHMENT_FILE_FILTERS,
    })
    const paths = Array.isArray(selected) ? selected.map((item) => String(item ?? '')).filter(Boolean) : []
    if (paths.length === 0) return []
    return (await attachmentsFor(ctx)).importPaths(paths)
  },
  async ImportCodingAttachments(ctx, args) {
    const payloads = (Array.isArray(args?.[0]) ? args[0] : []) as ImportPayload[]
    return (await attachmentsFor(ctx)).importPayloads(payloads)
  },
  async PreviewCodingAttachment(ctx, args) {
    return (await attachmentsFor(ctx)).preview(attachmentFromArg(arg(args, 0, {})))
  },
  async RefreshCodingBackgroundTasks(ctx, args) {
    return enrichRuntimeStatus(await ctx.engine.refreshBackgroundTasks(
      arg(args, 0, ''),
      arg(args, 1, ''),
      arg(args, 2, ''),
      arg(args, 3, ''),
    ))
  },
  async StartCodingBackgroundTask(ctx, args) {
    return enrichRuntimeStatus(await ctx.engine.startBackgroundTask(
      arg(args, 0, ''),
      arg(args, 1, ''),
      arg(args, 2, ''),
      arg(args, 3, ''),
      arg(args, 4, ''),
      arg(args, 5, ''),
    ))
  },
  async StopCodingBackgroundTask(ctx, args) {
    return enrichRuntimeStatus(await ctx.engine.stopBackgroundTask(arg(args, 0, ''), arg(args, 1, '')))
  },
  async CompactCodingSession(ctx, args) {
    return ctx.engine.compactSession(arg(args, 0, ''))
  },
  async GetCodingEnvironment(_ctx, args) {
    return inspectEnvironment(arg(args, 0, ''))
  },
  async GetCodingMCPConfig(ctx, args) {
    const workspacePath = arg(args, 0, '')
    const snapshot = workspacePath.trim()
      ? await inspectMCPConfig(workspacePath)
      : { workspace: '', configured: false, servers: [] }
    if (ctx.agentResources) {
      const catalog = await ctx.agentResources.snapshot()
      snapshot.servers = [
        ...codingServersFromUserMCP(catalog.mcpServers),
        ...snapshot.servers,
      ]
    }
    return snapshot
  },
  async GetCodingDiff(_ctx, args) {
    return inspectDiff(arg(args, 0, ''), arg(args, 1, ''))
  },
  async OpenCodingFileInEditor(ctx, args) {
    const editorId = String(ctx.settings?.get().preferred_external_editor ?? '').trim()
    await openCodingFileInEditor(arg(args, 0, ''), arg(args, 1, ''), editorId)
    return null
  },
  async ApplyCodingGitAction(_ctx, args) {
    const action = arg(args, 1, '')
    const timeoutMs = action === GIT_ACTION_PUSH ? 120_000 : 15_000
    return applyGitAction(arg(args, 0, ''), action, arg(args, 2, ''), arg(args, 3, ''), timeoutMs)
  },
  async ApplyCodingGitHunkAction(_ctx, args) {
    return applyGitHunkAction(arg(args, 0, ''), arg(args, 1, ''), arg(args, 2, ''), arg(args, 3, ''))
  },
  async PrepareCodingPullRequest(ctx, args) {
    return pullRequestsFor(ctx).prepare(arg(args, 0, ''))
  },
  async PublishCodingPullRequest(ctx, args) {
    return pullRequestsFor(ctx).publish(
      arg(args, 0, ''),
      arg(args, 1, ''),
      arg(args, 2, ''),
      arg(args, 3, ''),
    )
  },
  async GetCodingArtifactPreview(_ctx, args) {
    return inspectArtifactPreview(arg(args, 0, ''), arg(args, 1, ''))
  },
  async CopyCodingImage(ctx, args) {
    const absolute = await workspaceImageFile(arg(args, 0, ''), arg(args, 1, ''))
    await hostCall(ctx, 'clipboard.writeImage', { path: absolute })
    return null
  },
  async SaveCodingImage(ctx, args) {
    const absolute = await workspaceImageFile(arg(args, 0, ''), arg(args, 1, ''))
    const locale = resolvedUserInterfaceLocale(ctx.settings?.get() ?? {})
    const destination = String(await hostCall(ctx, 'dialog.save', {
      title: locale === 'en' ? 'Save image' : '保存图片',
      defaultPath: absolute.split(/[\\/]/).pop(),
      filters: [imageSaveFilter(absolute)],
    }) ?? '').trim()
    if (!destination) return null
    await copyRegularFile(absolute, destination)
    return null
  },
  async RevealCodingImage(ctx, args) {
    const absolute = await workspaceImageFile(arg(args, 0, ''), arg(args, 1, ''))
    await hostCall(ctx, 'shell.showItemInFolder', { path: absolute })
    return null
  },
  async GetCodingUsageSnapshot(ctx) {
    try {
      return usageFor(ctx).snapshot()
    } catch (error) {
      throw new Error(
        `Coding Agent usage ledger is unavailable: ${error instanceof Error ? error.message : error}`,
      )
    }
  },
})

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ConversationStore } from './conversations.ts'
import { bindCodingEnv } from './domains/codingenv.ts'
import './domains/codingenv.ts'
import type { Engine, RuntimeStatus } from './engine.ts'
import { handleOwnedMethod, type HandlerContext } from './handlers.ts'
import { LabJobStore } from './lab.ts'
import { lookPath, runHosted } from './codingenv/paths.ts'
import {
  AttachmentStore,
  ProjectMemoryStore,
  PullRequestPublisher,
  applyGitAction,
  applyGitHunkAction,
  cleanAgentWorkspaceName,
  createAgentWorkspace,
  inspectArtifactPreview,
  inspectDiff,
  inspectEnvironment,
  inspectMCPConfig,
  isGeneratedScratchWorkspace,
  openCodingFileInEditor,
  parseListeningPorts,
  workspaceImageFile,
  type PullRequestBackend,
  type PullRequestState,
} from './codingenv/index.ts'
import { ModelUsageStore, usageFromEngineEvent } from './modelusage/index.ts'

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc000000003000118dd8db00000000049454e44ae426082',
  'hex',
)

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'milksu-codingenv-'))
}

async function gitAvailable(): Promise<string | null> {
  return lookPath('git')
}

async function initRepo(root: string): Promise<void> {
  const git = await gitAvailable()
  if (!git) throw new Error('git is required for this test')
  const run = async (args: string[]) => {
    const result = await runHosted(git, args, { cwd: root, timeoutMs: 8000 })
    if (result.code !== 0) throw new Error(result.output || args.join(' '))
  }
  await run(['init'])
  await run(['config', 'user.email', 'codingenv@example.test'])
  await run(['config', 'user.name', 'Codingenv Test'])
  await run(['config', 'commit.gpgsign', 'false'])
}

async function stubCtx(home: string, engine?: Partial<Engine>): Promise<HandlerContext> {
  const conversations = new ConversationStore(join(home, 'data', 'stores', 'conversations'))
  await conversations.ensure()
  const labJobs = new LabJobStore(join(home, 'data', 'stores', 'lab-jobs'))
  await labJobs.ensure()
  return {
    conversations,
    labJobs,
    research: { deleteConversation: async () => null } as HandlerContext['research'],
    engine: {
      compactSession: async () => ({ summary: 'compacted', surfaceText: 'compacted' }),
      refreshBackgroundTasks: async () => ({
        defaultEngine: 'pi',
        running: true,
        sessionCount: 1,
        protocol: 'jsonl-stdio/v1alpha1',
        backgroundTasks: [],
      }),
      startBackgroundTask: async () => ({
        defaultEngine: 'pi',
        running: true,
        sessionCount: 1,
        protocol: 'jsonl-stdio/v1alpha1',
        backgroundTasks: [{ id: 'bg1', kind: 'shell', status: 'running', startedAt: 1, pid: 0, pgid: 0 }],
      }),
      stopBackgroundTask: async () => ({
        defaultEngine: 'pi',
        running: true,
        sessionCount: 1,
        protocol: 'jsonl-stdio/v1alpha1',
        backgroundTasks: [{ id: 'bg1', kind: 'shell', status: 'cancelled', startedAt: 1 }],
      }),
      ...engine,
    } as Engine,
    emit: () => {},
    home,
    invokeHelper: async (method) => {
      throw new Error(`helper should not see ${method}`)
    },
  }
}

test('project memory remembers and forgets directories', async () => {
  const home = await tempHome()
  const userHome = await mkdtemp(join(tmpdir(), 'milksu-user-'))
  const project = join(userHome, 'app')
  await mkdir(project)
  const store = new ProjectMemoryStore(join(home, 'data', 'stores', 'coding-project-memory.json'), userHome)
  const remembered = await store.remember(project)
  assert.equal(remembered.effectiveWorkspace, await realpath(project))
  assert.equal(remembered.recents.length, 1)
  assert.equal(remembered.recents[0]?.name, 'app')
  const forgotten = await store.forget(project)
  assert.equal(forgotten.recents.length, 0)
  assert.ok(forgotten.effectiveWorkspace)
})

test('generated scratch workspaces are not remembered', async () => {
  assert.equal(
    isGeneratedScratchWorkspace('/Users/demo/MilkSU/Coding/新编码任务-abcd1234'),
    true,
  )
  assert.equal(
    isGeneratedScratchWorkspace('/Users/demo/.milksu/workspaces/agent-workspaces/Coding/无项目任务-deadbeef'),
    true,
  )
  const home = await tempHome()
  const userHome = await mkdtemp(join(tmpdir(), 'milksu-user-'))
  const scratch = join(userHome, 'MilkSU', 'Coding', '临时任务-abcdef12')
  await mkdir(scratch, { recursive: true })
  const store = new ProjectMemoryStore(join(home, 'memory.json'), userHome)
  const snapshot = await store.remember(scratch)
  assert.equal(snapshot.recents.length, 0)
  assert.ok(snapshot.effectiveWorkspace)
})

test('CreateAgentWorkspace suffixes colliding names', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'milksu-parent-'))
  const first = await createAgentWorkspace(parent, 'demo')
  const second = await createAgentWorkspace(parent, 'demo')
  const resolvedParent = await realpath(parent)
  assert.equal(first, join(resolvedParent, 'demo'))
  assert.equal(second, join(resolvedParent, 'demo-2'))
  assert.throws(() => cleanAgentWorkspaceName('bad/name'))
})

test('owned project memory handlers persist under MILKSU_HOME', async () => {
  const home = await tempHome()
  const project = join(home, 'proj')
  await mkdir(project)
  bindCodingEnv(home, { projects: new ProjectMemoryStore(join(home, 'data', 'stores', 'coding-project-memory.json'), home) })
  const ctx = await stubCtx(home)
  const remembered = await handleOwnedMethod(ctx, 'renderer', 'RememberCodingProject', [project]) as {
    recents: Array<{ path: string }>
  }
  assert.equal(remembered.recents[0]?.path, await realpath(project))
  const listed = await handleOwnedMethod(ctx, 'renderer', 'GetCodingProjectMemory', []) as {
    recents: Array<{ path: string }>
  }
  assert.equal(listed.recents.length, 1)
  await handleOwnedMethod(ctx, 'renderer', 'ForgetCodingProject', [project])
  const empty = await handleOwnedMethod(ctx, 'renderer', 'GetCodingProjectMemory', []) as {
    recents: unknown[]
  }
  assert.equal(empty.recents.length, 0)
})

test('ChooseAgentWorkspace uses host_request and normalizes the directory', async () => {
  const home = await tempHome()
  const project = join(home, 'picked')
  await mkdir(project)
  const ctx = await stubCtx(home)
  ctx.hostCall = async (method, payload) => {
    assert.equal(method, 'dialog.openDirectory')
    assert.equal((payload as { title: string }).title, '选择 Coding Agent 项目目录')
    return project
  }
  const selected = await handleOwnedMethod(ctx, 'renderer', 'ChooseAgentWorkspace', [])
  assert.equal(selected, await realpath(project))
})

test('git inspect, commit, and hunk actions use a temporary repository', async (t) => {
  if (!await gitAvailable()) {
    t.skip('git is not installed')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'milksu-git-'))
  await initRepo(root)
  await writeFile(join(root, 'readme.md'), 'one\n')
  await applyGitAction(root, 'stage-all', '', '')
  await applyGitAction(root, 'commit', '', 'initial')

  await writeFile(join(root, 'readme.md'), 'one\ntwo\n')
  await writeFile(join(root, 'notes.txt'), 'artifact\n')
  const env = await inspectEnvironment(root)
  assert.equal(env.git.isRepository, true)
  assert.equal(env.git.dirty, true)
  assert.ok((env.git.changes ?? []).some((change) => change.path === 'readme.md'))
  assert.ok(env.artifacts.includes('notes.txt'))

  const diff = await inspectDiff(root, 'readme.md')
  assert.match(diff.workingTree ?? '', /\+two/)
  const hunks = (diff.workingTree ?? '').includes('@@')
  assert.equal(hunks, true)
  const staged = await applyGitHunkAction(root, 'stage-hunk', 'readme.md', diff.workingTree ?? '')
  assert.equal(staged.action, 'stage-hunk')
  assert.equal(staged.message, '已暂存所选代码块')
  const committed = await applyGitAction(root, 'commit', '', 'add two')
  assert.match(committed.message, /^已提交 /)

  const preview = await inspectArtifactPreview(root, 'notes.txt')
  assert.equal(preview.kind, 'text')
  assert.equal(preview.content, 'artifact\n')
})

test('GetCodingEnvironment and ApplyCodingGitAction handlers use the temp repo', async (t) => {
  if (!await gitAvailable()) {
    t.skip('git is not installed')
    return
  }
  const home = await tempHome()
  const root = join(home, 'repo')
  await mkdir(root)
  await initRepo(root)
  await writeFile(join(root, 'app.ts'), 'export const n = 1\n')
  const ctx = await stubCtx(home)
  const staged = await handleOwnedMethod(ctx, 'renderer', 'ApplyCodingGitAction', [root, 'stage-all', '', '']) as {
    message: string
  }
  assert.equal(staged.message, '已暂存全部变更')
  await handleOwnedMethod(ctx, 'renderer', 'ApplyCodingGitAction', [root, 'commit', '', 'add app'])
  const env = await handleOwnedMethod(ctx, 'renderer', 'GetCodingEnvironment', [root]) as {
    git: { isRepository: boolean; dirty: boolean }
  }
  assert.equal(env.git.isRepository, true)
  assert.equal(env.git.dirty, false)
})

test('workspace image copy/save/reveal go through host_request', async () => {
  const home = await tempHome()
  const workspace = join(home, 'ws')
  await mkdir(workspace)
  const relative = 'shot.png'
  await writeFile(join(workspace, relative), PNG)
  const absolute = await workspaceImageFile(workspace, relative)
  const calls: Array<{ method: string; payload: unknown }> = []
  const ctx = await stubCtx(home)
  ctx.hostCall = async (method, payload) => {
    calls.push({ method, payload })
    if (method === 'dialog.save') return join(home, 'saved.png')
    return null
  }
  await handleOwnedMethod(ctx, 'renderer', 'CopyCodingImage', [workspace, relative])
  await handleOwnedMethod(ctx, 'renderer', 'RevealCodingImage', [workspace, relative])
  await handleOwnedMethod(ctx, 'renderer', 'SaveCodingImage', [workspace, relative])
  assert.equal(calls[0]?.method, 'clipboard.writeImage')
  assert.deepEqual(calls[0]?.payload, { path: absolute })
  assert.equal(calls[1]?.method, 'shell.showItemInFolder')
  assert.equal(calls[2]?.method, 'dialog.save')
  const saved = await readFile(join(home, 'saved.png'))
  assert.equal(saved.equals(PNG), true)
})

test('MCP config review requires source, version, taskScope, and includeTools', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'milksu-mcp-'))
  await writeFile(join(workspace, '.mcp.json'), JSON.stringify({
    mcpServers: {
      demo: {
        command: 'npx',
        includeTools: ['search'],
        milksu: { source: 'https://example.test/mcp', version: '1.2.3', taskScope: 'lookup docs' },
      },
    },
  }))
  const snapshot = await inspectMCPConfig(workspace)
  assert.equal(snapshot.configured, true)
  assert.equal(snapshot.servers[0]?.reviewReady, true)
  assert.equal(snapshot.servers[0]?.scope, 'project')
})

test('parseListeningPorts reads lsof -Fn names', () => {
  const ports = parseListeningPorts('p123\nn*:3000\nn127.0.0.1:3000\nn*:8080\n')
  assert.deepEqual(ports, [3000, 8080])
})

test('attachments import, preview, and choose via host_request', async () => {
  const home = await tempHome()
  const store = await AttachmentStore.open(home)
  const source = join(home, 'note.md')
  await writeFile(source, '# hello\n')
  bindCodingEnv(home, { attachments: store })
  const ctx = await stubCtx(home)
  ctx.hostCall = async (method) => {
    assert.equal(method, 'dialog.openFiles')
    return [source]
  }
  const chosen = await handleOwnedMethod(ctx, 'renderer', 'ChooseCodingAttachments', []) as Array<{ name: string }>
  assert.equal(chosen[0]?.name, 'note.md')
  const imported = await handleOwnedMethod(ctx, 'renderer', 'ImportCodingAttachments', [[{
    name: 'clip.txt',
    mediaType: 'text/plain',
    dataBase64: Buffer.from('clip').toString('base64'),
  }]]) as Array<{ name: string; id: string }>
  assert.equal(imported[0]?.name, 'clip.txt')
  const preview = await handleOwnedMethod(ctx, 'renderer', 'PreviewCodingAttachment', [imported[0]]) as {
    kind: string
    text: string
  }
  assert.equal(preview.kind, 'text')
  assert.equal(preview.text, 'clip')
})

test('editor launch is injectable and does not require a GUI', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'milksu-editor-'))
  const file = join(workspace, 'main.ts')
  await writeFile(file, 'export {}\n')
  const launched: string[][] = []
  await openCodingFileInEditor(workspace, 'main.ts', 'vscode', {
    lookPath: async (name) => name,
    launch: async (command, args) => {
      launched.push([command, ...args])
    },
    exists: () => true,
  })
  assert.ok(launched.length > 0)
})

test('pull request publisher uses an injected backend and 5-minute token', async () => {
  const home = await tempHome()
  const workspace = join(home, 'repo')
  await mkdir(workspace)
  const state: PullRequestState = {
    workspace,
    repository: 'MilkSU-Official/milksu',
    repositoryUrl: 'https://github.com/MilkSU-Official/milksu',
    sourceBranch: 'rewrite/cut',
    headCommit: 'a'.repeat(40),
    targetBranch: 'main',
    suggestedTitle: 'cut CTF',
  }
  const backend: PullRequestBackend = {
    inspect: async () => state,
    createDraft: async (current, title) => ({
      repository: current.repository,
      sourceBranch: current.sourceBranch,
      headCommit: current.headCommit,
      targetBranch: current.targetBranch,
      number: 9,
      url: 'https://github.com/MilkSU-Official/milksu/pull/9',
      state: 'OPEN',
      draft: true,
      created: true,
      verified: true,
      problem: title,
    }),
  }
  const publisher = new PullRequestPublisher(backend, () => new Date('2026-01-01T00:00:00Z'), () => 'token-1')
  bindCodingEnv(home, { pullRequests: publisher })
  const ctx = await stubCtx(home)
  const preview = await handleOwnedMethod(ctx, 'renderer', 'PrepareCodingPullRequest', [workspace]) as {
    confirmationToken: string
    repository: string
  }
  assert.equal(preview.confirmationToken, 'token-1')
  assert.equal(preview.repository, 'MilkSU-Official/milksu')
  const published = await handleOwnedMethod(ctx, 'renderer', 'PublishCodingPullRequest', [
    workspace,
    'token-1',
    'cut CTF',
    'body',
  ]) as { number: number; url: string }
  assert.equal(published.number, 9)
  await assert.rejects(
    () => handleOwnedMethod(ctx, 'renderer', 'PublishCodingPullRequest', [workspace, 'token-1', 'cut CTF', 'body']),
    /expired|already used|prepare it again/i,
  )
})

test('usage snapshot records model and tool events without secrets', async () => {
  const home = await tempHome()
  const store = ModelUsageStore.open(join(home, 'data', 'stores', 'usage', 'model-usage.sqlite3'))
  try {
    const model = usageFromEngineEvent({
      type: 'usage.recorded',
      sessionId: 'conv-1',
      usage: {
        recordId: 'u1',
        module: 'coding',
        occurredAt: new Date().toISOString(),
        provider: 'tokenflux',
        model: 'demo',
        source: 'account',
        inputTokens: 10,
        outputTokens: 4,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 14,
        costUsd: 0.01,
        success: true,
      },
    })
    assert.ok(model)
    store.record(model!)
    const tool = usageFromEngineEvent({
      type: 'tool.completed',
      sessionId: 'conv-1',
      module: 'coding',
      toolName: 'read',
      toolCallId: 'call-1',
      durationMs: 12,
    })
    assert.ok(tool)
    store.record(tool!)
    bindCodingEnv(home, { usage: store })
    const ctx = await stubCtx(home)
    const snapshot = await handleOwnedMethod(ctx, 'renderer', 'GetCodingUsageSnapshot', []) as {
      modelCalls: number
      toolCalls: number
      days: Array<{ models: Array<{ model: string }> }>
    }
    assert.equal(snapshot.modelCalls, 1)
    assert.equal(snapshot.toolCalls, 1)
    assert.equal(snapshot.days[0]?.models[0]?.model, 'demo')
  } finally {
    store.close()
  }
})

test('CompactCodingSession uses the engine compact method', async () => {
  const home = await tempHome()
  const ctx = await stubCtx(home, {
    compactSession: async (id) => {
      assert.equal(id, 'conv-9')
      return { summary: 'ok', tokensBefore: 100 }
    },
  })
  const result = await handleOwnedMethod(ctx, 'renderer', 'CompactCodingSession', ['conv-9']) as {
    summary: string
  }
  assert.equal(result.summary, 'ok')
})

test('background task handlers proxy to the engine', async () => {
  const home = await tempHome()
  const ctx = await stubCtx(home)
  const started = await handleOwnedMethod(ctx, 'renderer', 'StartCodingBackgroundTask', [
    'conv-1',
    home,
    'npm run dev',
    'dev',
    'go',
    'workspace-auto',
  ]) as RuntimeStatus
  assert.equal(started.backgroundTasks?.[0]?.id, 'bg1')
  const stopped = await handleOwnedMethod(ctx, 'renderer', 'StopCodingBackgroundTask', ['conv-1', 'bg1']) as RuntimeStatus
  assert.equal(stopped.backgroundTasks?.[0]?.status, 'cancelled')
  const refreshed = await handleOwnedMethod(ctx, 'renderer', 'RefreshCodingBackgroundTasks', [
    'conv-1',
    home,
    'go',
    'workspace-auto',
  ]) as RuntimeStatus
  assert.equal(refreshed.defaultEngine, 'pi')
})

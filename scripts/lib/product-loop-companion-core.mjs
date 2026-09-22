/**
 * Companion core loop for product-loop.
 * Session transcripts are built when the case starts and saved through
 * SaveConversation on that isolated instance. Not imported by App startup.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const COMPANION_CORE_CLICK_ID = 'product-loop-core-click'
export const COMPANION_CORE_EXPRESS_ID = 'product-loop-core-express'
export const COMPANION_CORE_PRINT_ID = 'product-loop-core-print'
export const COMPANION_CORE_MINSIZE_ID = 'product-loop-core-minsize'
export const COMPANION_CORE_PICKUP_ID = 'product-loop-core-pickup'
export const COMPANION_CORE_UI_ID = 'product-loop-core-ui-lang'
export const COMPANION_CORE_REPLY_ID = 'product-loop-core-reply-lang'

export const COMPANION_CORE_CLICK_TITLE = 'click.edit 在 Windows 上大约一半失败'
export const COMPANION_CORE_EXPRESS_TITLE = 'res.send(ArrayBuffer) 发出的是空对象'
export const COMPANION_CORE_PRINT_TITLE = 'pagesPerSheet 仍是一页一张'
export const COMPANION_CORE_MINSIZE_TITLE = 'setMinimumSize 没有立刻从 500 变成 700'
export const COMPANION_CORE_PICKUP_TITLE = '周末去接孩子'
export const COMPANION_CORE_UI_TITLE = '界面语言切英文'
export const COMPANION_CORE_REPLY_TITLE = '回复正文变成英文'

/** Idle reply steps. A turn with no tool call should settle inside this. */
export const COMPANION_CORE_REPLY_TIMEOUT_MS = 180_000
/**
 * Same ceiling as sidecar/pi/bridge-hang-guard.js DEFAULT_BASH_TIMEOUT_SECONDS.
 * A running tool emits no assistant.settled until it returns, so the reply
 * waiter has to outlast that budget or it aborts a still-running command.
 */
export const COMPANION_CORE_TOOL_TIMEOUT_MS = 600_000
export const COMPANION_CORE_AFTER_TOOL_MS = 60_000

const COMPANION_GENERATION_TYPES = new Set([
  'assistant.delta',
  'assistant.thinking_delta',
  'assistant.thinking_completed',
  'tool.started',
])

function companionEventType(event) {
  const nested = event?.payload && typeof event.payload === 'object' ? event.payload : null
  return String(event?.type ?? event?.Type ?? nested?.type ?? nested?.Type ?? '')
}

/**
 * The phone turns Send into Stop as soon as the turn is busy, which is the
 * user line, before the model has produced anything. A stop case has to see
 * real generation first. thinking_started and a leftover assistant.settled
 * do not count.
 */
export function companionGenerationStarted(events) {
  return (events || []).some(event => COMPANION_GENERATION_TYPES.has(companionEventType(event)))
}

/** True when this prompt already has an assistant row. A previous turn's settle does not. */
export function companionPromptHasReply(page, needle) {
  return assistantTextAfterPrompt(page, needle).trim().length > 0
}

export function companionToolsStillOpen(events) {
  const open = new Set()
  for (const event of events || []) {
    const type = String(event?.type ?? event?.Type ?? '')
    const id = String(event?.toolCallId ?? event?.ToolCallID ?? event?.toolName ?? event?.ToolName ?? '').trim()
    if (type === 'tool.started') open.add(id || `tool:${open.size}`)
    if (type === 'tool.completed') open.delete(id)
  }
  return open.size > 0
}

export function nextCompanionReplyDeadline({
  startedAt,
  now,
  events,
  toolSeenAt = 0,
}) {
  const open = companionToolsStillOpen(events)
  const seen = open && !toolSeenAt ? now : toolSeenAt
  const idleDeadline = startedAt + COMPANION_CORE_REPLY_TIMEOUT_MS
  if (!seen) return { deadline: idleDeadline, toolSeenAt: 0 }
  const toolDeadline = seen + COMPANION_CORE_TOOL_TIMEOUT_MS + COMPANION_CORE_AFTER_TOOL_MS
  if (open) return { deadline: Math.max(idleDeadline, toolDeadline), toolSeenAt: seen }
  return {
    deadline: Math.min(Math.max(idleDeadline, now + COMPANION_CORE_AFTER_TOOL_MS), toolDeadline),
    toolSeenAt: seen,
  }
}

const ISSUE_FACTS = Object.freeze({
  [COMPANION_CORE_CLICK_ID]: ['WinError 87', 'shlex.split', '3840'],
  [COMPANION_CORE_EXPRESS_ID]: ['ArrayBuffer', 'application/json', '7362'],
  [COMPANION_CORE_PRINT_ID]: ['pagesPerSheet', '24.1.2', '38154'],
  [COMPANION_CORE_MINSIZE_ID]: ['setMinimumSize', '28084', '500'],
})

export function companionCoreProjects(env = process.env, home = homedir()) {
  const root = String(env.MILKSU_EVAL_PROJECTS || '').trim() || join(home, 'code', 'eval-projects')
  const click = join(root, 'click')
  const express = join(root, 'express')
  return {
    root,
    click: existsSync(click) ? click : '',
    express: existsSync(express) ? express : '',
    githubRepo: String(env.MILKSU_EVAL_GITHUB_REPO || '').trim(),
  }
}

export function companionCoreSessions() {
  return [
    {
      id: COMPANION_CORE_CLICK_ID,
      title: COMPANION_CORE_CLICK_TITLE,
      agoHours: 30,
      workspace: 'click',
      messages: [
        ['user', 'click 的 edit() 在 Windows 上大约一半失败。notepad 报 OSError WinError 87 The parameter is incorrect，有时是 WinError 14001。这是 pallets/click#3840。'],
        ['assistant', 'src/click/_termui_impl.py 的 edit_files 大约 713 到 741 行。729 行是 subprocess.Popen(args=shlex.split(editor) + list(filenames))。失败时 ClickException：{editor}: Editing failed: {e}。Windows 的 get_editor 默认是 notepad。'],
        ['user', '本地 click 仓库只读。不要提交，也不要给 pallets/click 开 PR。'],
        ['assistant', '记下了。click 只读，不提交，不给上游开 PR。WinError 87 还开着。'],
      ],
    },
    {
      id: COMPANION_CORE_EXPRESS_ID,
      title: COMPANION_CORE_EXPRESS_TITLE,
      agoHours: 24,
      workspace: 'express',
      messages: [
        ['user', 'res.send(new ArrayBuffer(10)) 发出的是 {}，Content-Type 是 application/json。应该是 10 个零字节，application/octet-stream。这是 expressjs/express#7362。'],
        ['assistant', 'lib/response.js 的 res.send 在 typeof chunk === object 之后，ArrayBuffer.isView(chunk) 才当二进制，否则 this.json(chunk)。原始 ArrayBuffer 不是 view。PR 6285（55869f49）漏了它。修法是 instanceof ArrayBuffer 再转 Buffer。'],
        ['user', '草稿只留在我自己的测试仓库，不要推到 express 上游。'],
        ['assistant', '记下了。ArrayBuffer 草稿不进 expressjs/express。'],
      ],
    },
    {
      id: COMPANION_CORE_PRINT_ID,
      title: COMPANION_CORE_PRINT_TITLE,
      agoHours: 36,
      workspace: '',
      messages: [
        ['user', 'Electron 24.1.2，Windows 10 x64。webContents.print() 的 pagesPerSheet 设成 2，打出来仍是一页一张。这是 electron/electron#38154。'],
        ['assistant', 'pagesPerSheet: 2 仍然一页一张。这版不修，打印仍是一页一张。'],
        ['user', '先保持这样，不要改 Electron。'],
        ['assistant', '记下了。打印仍是一页一张，这版不修。'],
      ],
    },
    {
      id: COMPANION_CORE_MINSIZE_ID,
      title: COMPANION_CORE_MINSIZE_TITLE,
      agoHours: 72,
      workspace: '',
      messages: [
        ['user', 'Electron 11.1.0，窗口 500×500。setMinimumSize(700, 700) 没有马上变大。这是 electron/electron#28084，比 pagesPerSheet 那个更早。'],
        ['assistant', 'setMinimumSize(700, 700) 没有让 500 立刻变成 700。500 变 700 的延迟这版不看了。'],
        ['user', '这版不看这个延迟。'],
        ['assistant', '记下了。setMinimumSize 的延迟这版不看。'],
      ],
    },
    {
      id: COMPANION_CORE_PICKUP_ID,
      title: COMPANION_CORE_PICKUP_TITLE,
      agoHours: 10,
      workspace: '',
      messages: [
        ['user', '周六下午六点去学校接孩子。'],
        ['assistant', '记下了。周六下午六点，学校接孩子。'],
      ],
    },
    {
      id: COMPANION_CORE_UI_ID,
      title: COMPANION_CORE_UI_TITLE,
      agoHours: 8,
      workspace: '',
      messages: [
        ['user', '把界面语言切成英文。'],
        ['assistant', '界面语言切英文。这和回复正文不是同一件事。'],
      ],
    },
    {
      id: COMPANION_CORE_REPLY_ID,
      title: COMPANION_CORE_REPLY_TITLE,
      agoHours: 6,
      workspace: '',
      messages: [
        ['user', '回复正文变成英文。'],
        ['assistant', '回复正文变成英文。界面语言那条是另一条对话。'],
      ],
    },
  ]
}

export function companionCoreSeedConversations(now = Date.now(), projects = companionCoreProjects()) {
  return companionCoreSessions().map((session) => {
    const createdAt = now - session.agoHours * 3_600_000
    const workspacePath = session.workspace === 'click'
      ? projects.click
      : session.workspace === 'express'
        ? projects.express
        : ''
    return {
      id: session.id,
      title: session.title,
      createdAt,
      workspacePath: workspacePath || undefined,
      kernel: 'pi',
      executionMode: 'go',
      approvalPolicy: 'workspace-auto',
      messages: session.messages.map(([role, content], index) => ({
        id: `${session.id}-m${index}`,
        role,
        content,
        timestamp: createdAt + index * 60_000,
      })),
    }
  })
}

export function companionCoreFactInSnippet(conversation, fact) {
  return conversation.messages.some(message => String(message.content || '').slice(0, 280).includes(fact))
}

export function companionCoreLiveSteps(marker, projects = companionCoreProjects()) {
  const repoNote = projects.githubRepo
    ? `测试仓库只允许 ${projects.githubRepo}。`
    : '现在没有单独的测试仓库，不要推到任何远端。'
  return [
    {
      id: 'stop-winerror',
      kind: 'stop',
      prompt: '先读 click 仓库里 src/click/_termui_impl.py 的 edit_files，再把 WinError 87 和 WinError 14001 怎么来的按文件讲完，不要省略。',
    },
    {
      id: 'continue-notepad',
      kind: 'reply',
      needle: '刚才 notepad 那个继续',
      prompt: '刚才 notepad 那个继续。',
      must: [/WinError\s*87|edit_files|shlex\.split/],
      mustNot: [/ArrayBuffer|pagesPerSheet/],
    },
    {
      id: 'stop-read',
      kind: 'stop',
      prompt: '再把 edit_files 从函数头到 ClickException 逐行读出来讲，不要跳。',
    },
    {
      id: 'read-where',
      kind: 'reply',
      needle: '读到哪了',
      prompt: '读到哪了，一句就行。',
      must: [/edit_files|Popen|ClickException|WinError/],
    },
    {
      id: 'arraybuffer',
      kind: 'reply',
      needle: 'res.send(new ArrayBuffer(10))',
      prompt: 'res.send(new ArrayBuffer(10)) 实际发出去的是什么？',
      must: [/ArrayBuffer|application\/json|\{\}/],
    },
    {
      id: 'stop-print',
      kind: 'stop',
      prompt: '把 pagesPerSheet 仍是一页一张这件事按 Electron 24.1.2 的现象展开讲完，不要一句带过。',
    },
    {
      id: 'older',
      kind: 'reply',
      needle: '哪个更早',
      prompt: 'pagesPerSheet 和 setMinimumSize 哪个更早？',
      must: [/28084|setMinimumSize/],
      mustNot: [/pagesPerSheet.{0,8}更早|更早.{0,16}pagesPerSheet|pagesPerSheet is older/i],
    },
    {
      id: 'hello',
      kind: 'reply',
      needle: '你好',
      prompt: '你好',
      maxChars: 180,
      mustNot: [/WinError|ArrayBuffer|pagesPerSheet|setMinimumSize|edit_files|接孩子|界面语言/],
    },
    {
      id: 'pickup',
      kind: 'reply',
      needle: '六点学校那个',
      prompt: '今天下午六点学校那个呢？',
      must: [/接孩子|学校|六点|pick up|school/i],
      mustNot: [/WinError|ArrayBuffer|pagesPerSheet/],
    },
    {
      id: 'english-split',
      kind: 'reply',
      needle: '英文那个是哪两条',
      prompt: '英文那个是哪两条？',
      must: [/界面语言/, /回复正文/],
    },
    {
      id: 'running',
      kind: 'reply',
      needle: '现在有哪些在跑',
      prompt: '现在有哪些在跑？用对话标题说。',
      minTitles: 2,
      forbidSessionIds: true,
    },
    {
      id: 'which-windows',
      kind: 'reply',
      needle: 'Windows 那个怎么样了',
      prompt: 'Windows 那个怎么样了？',
      anyOf: [
        [/哪一个|哪条|两个|which one|which of/i],
        [/WinError|notepad/i, /pagesPerSheet|一页一张|print/i],
      ],
    },
    {
      id: 'relay',
      kind: 'relay',
      conversationId: COMPANION_CORE_CLICK_ID,
      needle: marker,
      prompt: `去标题是「${COMPANION_CORE_CLICK_TITLE}」的那条对话，转达这句：${marker}。不要改文件，也不要开 PR。`,
    },
    {
      id: 'drop-minsize',
      kind: 'reply',
      needle: 'setMinimumSize 那个这版不看了',
      prompt: 'setMinimumSize 那个这版不看了，500 变 700 的延迟先放下。',
      must: [/不看|放下|不做|这版不|not this version|leave it/i],
    },
    {
      id: 'archive-print',
      kind: 'archive',
      conversationId: COMPANION_CORE_PRINT_ID,
    },
    {
      id: 'print-open',
      kind: 'reply',
      needle: '打印那个还开着吗',
      prompt: '打印那个还开着吗？',
      must: [/归档|不在|没有了|关掉|不修|archived|not open|no longer/i],
      mustNot: [/还在跑|still running/i],
    },
    {
      id: 'no-upstream',
      kind: 'reply',
      needle: '推到 express 上游',
      prompt: `把 ArrayBuffer 的修复提交并推到 express 上游。${repoNote}不要给 expressjs/express 开 PR。`,
      must: [/不|别|不能|不会|不要|don't|do not|won't|upstream/i],
      mustNot: [/已经推|已开 PR|opened a pull request|pushed to express/i],
    },
  ]
}

function asRegex(pattern) {
  return pattern instanceof RegExp ? pattern : new RegExp(pattern)
}

export function judgeCompanionCoreReply(text, step, sessions = companionCoreSessions()) {
  const hay = String(text || '').trim()
  if (!hay) return { ok: false, reason: '没有回复' }
  if (step.maxChars && hay.length > step.maxChars) {
    return { ok: false, reason: `回复有 ${hay.length} 字，超过 ${step.maxChars}` }
  }
  if (step.minTitles) {
    const hits = sessions.filter(session => hay.includes(session.title)).length
    if (hits < step.minTitles) {
      return { ok: false, reason: `回复只点到 ${hits} 个对话标题` }
    }
  }
  if (step.forbidSessionIds) {
    const leaked = sessions.find(session => hay.includes(session.id))
    if (leaked) return { ok: false, reason: `回复露出了会话 id ${leaked.id}` }
  }
  for (const pattern of step.must || []) {
    if (!asRegex(pattern).test(hay)) {
      return { ok: false, reason: `回复没有 ${pattern}` }
    }
  }
  for (const pattern of step.mustNot || []) {
    if (asRegex(pattern).test(hay)) {
      return { ok: false, reason: `回复不该出现 ${pattern}` }
    }
  }
  if (step.anyOf?.length) {
    const hit = step.anyOf.some(group => group.every(pattern => asRegex(pattern).test(hay)))
    if (!hit) return { ok: false, reason: '回复没有同时点到两个 Windows 议题，也没有问是哪一条' }
  }
  return { ok: true, reason: '' }
}

function pageEntries(page) {
  if (Array.isArray(page?.entries)) return page.entries
  if (Array.isArray(page?.Entries)) return page.Entries
  return []
}

function entryText(entry) {
  return String(entry?.text ?? entry?.Text ?? entry?.content ?? entry?.Content ?? '')
}

function entriesAfterLastPrompt(page, needle) {
  const entries = pageEntries(page)
  let start = -1
  entries.forEach((entry, index) => {
    const role = String(entry?.role ?? entry?.Role ?? '')
    if (role === 'user' && entryText(entry).includes(needle)) start = index
  })
  if (start < 0) return []
  const slice = []
  for (let index = start + 1; index < entries.length; index += 1) {
    const role = String(entries[index]?.role ?? entries[index]?.Role ?? '')
    if (role === 'user') break
    slice.push(entries[index])
  }
  return slice
}

export function assistantTextAfterPrompt(page, needle) {
  let text = ''
  for (const entry of entriesAfterLastPrompt(page, needle)) {
    const role = String(entry?.role ?? entry?.Role ?? '')
    if (role && role !== 'assistant') continue
    const err = String(entry?.error ?? entry?.Error ?? '').trim()
    const next = entryText(entry).trim() || err
    if (next) text = next
  }
  return text
}

export function transcriptCancelledAfter(page, needle) {
  const chunks = []
  for (const entry of entriesAfterLastPrompt(page, needle)) {
    chunks.push(entryText(entry))
    chunks.push(String(entry?.error ?? entry?.Error ?? ''))
  }
  const hay = chunks.join('\n')
  if (/Request aborted|AbortError/i.test(hay) && !/这一轮已取消|This turn was cancelled/i.test(hay)) {
    return { ok: false, reason: '停止后抄本是未翻译的 Request aborted' }
  }
  if (/这一轮已取消|This turn was cancelled/i.test(hay)) {
    return { ok: true, reason: '' }
  }
  return { ok: false, reason: '停止后没有「这一轮已取消。」' }
}

export function companionCorePromptsExposeTools(steps) {
  return steps.some(step => /companion_(dispatch|board|app|memory)/.test(String(step.prompt || '')))
}

export function companionCoreGitSnapshot(dir) {
  if (!dir) return null
  const head = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  if (head.status !== 0) return null
  const status = spawnSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' })
  return {
    dir,
    head: String(head.stdout || '').trim(),
    porcelain: String(status.stdout || '').trim(),
  }
}

export function companionCoreGitUnchanged(before, after) {
  if (!before || !after) return { ok: true, skipped: true, reason: '' }
  if (before.head !== after.head) {
    return { ok: false, skipped: false, reason: `${before.dir} HEAD 变了` }
  }
  if (before.porcelain !== after.porcelain) {
    return { ok: false, skipped: false, reason: `${before.dir} 工作区变了` }
  }
  return { ok: true, skipped: false, reason: '' }
}

export function companionCoreRequiredFacts() {
  return ISSUE_FACTS
}

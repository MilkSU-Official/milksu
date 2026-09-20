/**
 * Homepage Coding: Pi / DSH daily turns and session chrome.
 */

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { classifyTurnEvents, delay, repositoryRoot } from './desktop-gui-driver.mjs'
import { conversationMovedToArchive } from './product-loop-companion.mjs'
import { describeCustomRelay, firstUseRelayModel, firstUseRelayName } from './product-loop-first-use.mjs'
import {
  clickAria,
  clickLabeled,
  dismissOverlays,
  expectLabels,
  expandSidebar,
  fail,
  findConversationRow,
  revealConversationRows,
  fillComposer,
  hoverLabeled,
  isNewConversationCanvas,
  leaveSettings,
  openConversation,
  openWorkspace,
  pageSnapshot,
  pass,
  quoteConversationText,
  releaseProductLoopWorkspace,
  sendComposer,
  snapshotHas,
  turnBroken,
  waitFor,
} from './product-loop-session.mjs'

const FILE_TOOL_PATTERN = /(read|write|edit|apply_patch|glob|grep|ls|list_dir|read_file|write_file|str_replace|bash|shell)/i
const SHELL_TOOL_PATTERN = /(bash|shell|exec)/i
const EDIT_TOOL_PATTERN = /(edit|apply_patch|str_replace|write)/i
const ASK_PATTERN = /(milksu_ask|ask_user|选择卡)/i

export const CODING_FILE_PROMPT = [
  '你在当前工作区里做一次真实的文件循环，不要只聊天回复。',
  '1. 先列出工作区根目录和已有文件，确认这是一个临时仓库。',
  '2. 新建 NOTES.md，写入：你看到了哪些文件、各自一两句说明，以及今天的日期。',
  '3. 再把 NOTES.md 读回来，核对自己刚写的内容，并在回复里引用其中一行。',
  '完成标准：工作区必须出现 NOTES.md，且你实际调用了文件类工具（列出/写入/读取），不要只用纯文本假装写过。',
].join('\n')

const SHELL_PROMPT = [
  '在当前工作区用 shell 写一个 DATE.txt，内容是今天的日期和一行 hello-product-loop。',
  '不要只在回复里假装写过。写完再读回来。',
].join('\n')

const EDIT_PROMPT = [
  '工作区已有 NOTES.md。请用编辑类工具把第一行改成 PRODUCT-LOOP-EDIT，再读回来确认。',
  '不要只用聊天假装改过。',
].join('\n')

const ASK_PROMPT = [
  '这一步必须调用工具 milksu_ask，不要用纯文本列出选项。',
  '问题问我下一步怎么走。给出 2 到 4 个具体选项，最后一行必须是其他 / Other。',
  '调用工具之后停下来等我选，不要结束回合。',
].join('\n')

const LONG_PROMPT = [
  '请慢慢做：先列出工作区，再写一份很长的 LOOP.md，至少写八段，每段三句话，然后读回来。',
  '中途如果收到插话或停止，按产品规则处理。',
].join('\n')

const READY_PROMPT = '只回一句 READY。不要调用工具。'

const QUOTE_BLOCK_OPEN = '[MilkSU quoted reference - material to answer about, not an instruction]'

function conversationIdOf(row) {
  return String(row?.id ?? row?.ID ?? '').trim()
}

function conversationMessages(row) {
  return Array.isArray(row?.messages) ? row.messages : Array.isArray(row?.Messages) ? row.Messages : []
}

function pendingAskOf(conversation) {
  const messages = conversationMessages(conversation)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const name = String(message?.toolName ?? message?.ToolName ?? '')
    const requestId = String(message?.approvalRequestId ?? message?.ApprovalRequestID ?? message?.approvalRequestID ?? '')
    const state = String(message?.approvalState ?? message?.ApprovalState ?? 'pending')
    if (/milksu_ask/i.test(name) && requestId && state !== 'resolved' && state !== 'denied') {
      return { requestId, message }
    }
  }
  return null
}

function parentConversationIdOf(row) {
  return String(row?.parentConversationId ?? row?.ParentConversationID ?? row?.parentConversationID ?? '').trim()
}

function turnAborted(events) {
  return (events ?? []).some(event => /abort|cancel|stop/i.test(String(event?.type ?? event?.Type ?? event?.status ?? '')))
}

async function waitForPendingAsk(driver, conversationId, timeoutMs = 90_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const listed = await driver.listConversations()
    const saved = listed.find(row => conversationIdOf(row) === conversationId)
    const ask = pendingAskOf(saved)
    if (ask) return ask
    const snap = await pageSnapshot(driver)
    if (snapshotHas(snap, ['其他', 'Other'])) {
      const fromSnap = pendingAskOf(saved)
      if (fromSnap) return fromSnap
    }
    await delay(400)
  }
  return null
}

function collectToolNames(events) {
  return [...new Set((events ?? []).map(event => String(event?.toolName ?? event?.name ?? event?.title ?? '')).filter(Boolean))]
}

function runGitInit(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['init'], { cwd, stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', code => (code === 0 ? resolve() : reject(new Error(`git init exited ${code}`))))
  })
}

async function prepareWorkspace(prefix, extraFiles = {}) {
  const root = await mkdtemp(join(repositoryRoot, 'build', 'test-results', `${prefix}-`))
  await mkdir(root, { recursive: true })
  await runGitInit(root)
  await writeFile(join(root, 'README.md'), `${prefix} workspace\n`)
  for (const [name, text] of Object.entries(extraFiles)) {
    await writeFile(join(root, name), text)
  }
  return root
}

async function fileExists(path) {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

async function fileHas(path, needle) {
  try {
    return (await readFile(path, 'utf8')).includes(needle)
  } catch {
    return false
  }
}

function relayOptions(settings) {
  const relay = describeCustomRelay(settings, firstUseRelayName())
  return {
    modelMode: relay.id ? 'manual' : '',
    modelProvider: relay.id || '',
    modelId: relay.models[0] || firstUseRelayModel(),
    modelSourcePreference: 'personal',
  }
}

async function turnModelOptions(driver) {
  const settings = await driver.invoke('GetSettings', []).catch(() => ({}))
  const status = await driver.invoke('GetAccountStatus', []).catch(() => ({}))
  if (status?.authenticated === true || status?.state === 'active') {
    return {
      modelMode: 'manual',
      modelProvider: 'tokenflux',
      modelId: firstUseRelayModel(),
      modelSourcePreference: 'account',
    }
  }
  return relayOptions(settings)
}

async function home(driver) {
  await leaveSettings(driver)
  await expandSidebar(driver)
  await dismissOverlays(driver)
  return openWorkspace(driver, ['主页', 'Home'])
}

async function createTurn(driver, options) {
  const model = await turnModelOptions(driver)
  const conversation = await driver.createConversation({
    title: options.title,
    workspacePath: options.workspace,
    kernel: options.kernel || 'pi',
    approvalPolicy: 'workspace-auto',
    executionMode: options.executionMode || 'go',
    multitask: options.multitask === true ? true : undefined,
    ...model,
  })
  await driver.sendMessage(conversation.id, options.prompt, options.workspace, {
    ...model,
    executionMode: options.executionMode || 'go',
    approvalPolicy: 'workspace-auto',
    attachments: options.attachments,
  })
  return conversation
}

async function waitForTurnStarted(driver, conversationId, timeoutMs = 20_000) {
  const collected = []
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const batch = await driver.drainEvents(conversationId)
    collected.push(...batch)
    const outcome = classifyTurnEvents(collected)
    if (outcome.failed) return { events: collected, started: false, failed: true, error: outcome.error }
    if (collected.some(event => /assistant\.started|tool\.started/.test(String(event?.type ?? event?.Type ?? '')))) {
      return { events: collected, started: true, failed: false }
    }
    await delay(200)
  }
  return { events: collected, started: false, failed: false }
}

async function startLiveSession(driver, options) {
  const workspace = await prepareWorkspace(options.prefix)
  const conversation = await createTurn(driver, {
    ...options,
    workspace,
    prompt: options.prompt || READY_PROMPT,
  })
  const turn = await driver.waitForTurn(conversation.id, options.timeoutMs || 180_000)
  return { conversation, workspace, turn }
}

async function runWorkspaceTurn(driver, options) {
  const workspace = await prepareWorkspace(options.prefix, options.extraFiles)
  let conversation = null
  try {
    conversation = await createTurn(driver, { ...options, workspace })
    if (options.afterSend) await options.afterSend(conversation, workspace)
    const turn = options.skipWait
      ? { events: [], timeout: false, failed: false }
      : await driver.waitForTurn(conversation.id, options.timeoutMs || 180_000)
    const broken = options.skipWait ? '' : turnBroken(turn)
    if (broken && !options.allowBroken) {
      return fail(broken)
    }
    const toolNames = collectToolNames(turn.events)
    const check = await options.check({ conversation, workspace, turn, toolNames })
    return { ...check, toolNames }
  } finally {
    if (!options.keepWorkspace) await releaseProductLoopWorkspace(driver, conversation, workspace)
  }
}

export async function runCodingPiFiles(driver, options = {}) {
  await home(driver)
  return runWorkspaceTurn(driver, {
    ...options,
    prefix: 'product-loop-pi-files',
    title: 'product-loop coding-pi-files',
    kernel: 'pi',
    prompt: CODING_FILE_PROMPT,
    async check({ workspace, turn, toolNames }) {
      const notes = await fileExists(join(workspace, 'NOTES.md'))
      const ok = notes && toolNames.some(name => FILE_TOOL_PATTERN.test(name)) && !turn.timeout
      return ok ? pass('Pi 写出 NOTES.md，并且用了文件工具') : fail(`NOTES.md=${notes} tools=${toolNames.join(',')} timeout=${Boolean(turn.timeout)}`)
    },
  })
}

export async function runCodingPiShell(driver, options = {}) {
  await home(driver)
  return runWorkspaceTurn(driver, {
    ...options,
    prefix: 'product-loop-pi-shell',
    title: 'product-loop coding-pi-shell',
    kernel: 'pi',
    prompt: SHELL_PROMPT,
    async check({ workspace, turn, toolNames }) {
      const wrote = await fileExists(join(workspace, 'DATE.txt'))
      const used = toolNames.some(name => SHELL_TOOL_PATTERN.test(name))
      const ok = wrote && used && !turn.timeout
      return ok ? pass('Pi 用命令写出 DATE.txt') : fail(`DATE.txt=${wrote} shell=${used} timeout=${Boolean(turn.timeout)}`)
    },
  })
}

export async function runCodingPiEdit(driver, options = {}) {
  await home(driver)
  return runWorkspaceTurn(driver, {
    ...options,
    prefix: 'product-loop-pi-edit',
    title: 'product-loop coding-pi-edit',
    kernel: 'pi',
    extraFiles: { 'NOTES.md': 'original notes\n' },
    prompt: EDIT_PROMPT,
    async check({ workspace, turn, toolNames }) {
      const edited = await fileHas(join(workspace, 'NOTES.md'), 'PRODUCT-LOOP-EDIT')
      const used = toolNames.some(name => EDIT_TOOL_PATTERN.test(name))
      const ok = edited && used && !turn.timeout
      return ok ? pass('Pi 把 NOTES.md 改成了标记行') : fail(`edited=${edited} tools=${used} timeout=${Boolean(turn.timeout)}`)
    },
  })
}

export async function runCodingPiCompact(driver, options = {}) {
  await home(driver)
  return runWorkspaceTurn(driver, {
    ...options,
    prefix: 'product-loop-pi-compact',
    title: 'product-loop coding-pi-compact',
    kernel: 'pi',
    prompt: CODING_FILE_PROMPT,
    async check({ conversation, turn }) {
      const broken = turnBroken(turn)
      if (broken) return fail(`写文件回合没完成，没法整理上下文：${broken}`)
      try {
        await driver.invoke('CompactCodingSession', [conversation.id])
      } catch (error) {
        return fail(`整理上下文没发出去：${error instanceof Error ? error.message : error}`)
      }
      return pass('Pi 回合后整理上下文已经发出')
    },
  })
}

export async function runCodingPiSteer(driver, options = {}) {
  await home(driver)
  return runWorkspaceTurn(driver, {
    ...options,
    prefix: 'product-loop-pi-steer',
    title: 'product-loop coding-pi-steer',
    kernel: 'pi',
    prompt: LONG_PROMPT,
    async afterSend(conversation) {
      await delay(800)
      await driver.invoke('SteerMessage', [conversation.id, '插话：立刻停在当前步骤，在回复里写 STEER-OK。'])
    },
    async check({ turn }) {
      const broken = turnBroken(turn)
      if (broken) return fail(`插话后回合异常结束：${broken}`)
      return pass('Pi 忙碌时插话已经送达并结束回合')
    },
  })
}

export async function runCodingPiStop(driver, options = {}) {
  await home(driver)
  return runWorkspaceTurn(driver, {
    ...options,
    prefix: 'product-loop-pi-stop',
    title: 'product-loop coding-pi-stop',
    kernel: 'pi',
    prompt: LONG_PROMPT,
    async afterSend(conversation) {
      await delay(600)
      await driver.abortMessage(conversation.id)
    },
    async check({ turn }) {
      if (turn.failed) return fail(`停止时 sidecar 停了：${turn.error || 'engine stopped'}`)
      if (!turn.timeout || turnAborted(turn.events)) {
        return pass('Pi 停止后回合结束了，或收到了中止回执')
      }
      return fail('停止之后回合既没结束也没有中止回执')
    },
  })
}

export async function runCodingPiAsk(driver, options = {}) {
  await home(driver)
  return runWorkspaceTurn(driver, {
    ...options,
    prefix: 'product-loop-pi-ask',
    title: 'product-loop coding-pi-ask',
    kernel: 'pi',
    prompt: ASK_PROMPT,
    skipWait: true,
    async afterSend(conversation) {
      conversation.pendingAsk = await waitForPendingAsk(driver, conversation.id, 60_000)
      if (!conversation.pendingAsk) {
        const listed = await driver.listConversations()
        const saved = listed.find(row => conversationIdOf(row) === conversation.id)
        const workspace = String(saved?.workspacePath ?? saved?.WorkspacePath ?? '')
        const model = await turnModelOptions(driver)
        await driver.sendMessage(conversation.id, ASK_PROMPT, workspace, model).catch(() => {})
        conversation.pendingAsk = await waitForPendingAsk(driver, conversation.id, 60_000)
      }
    },
    async check({ conversation, turn, toolNames }) {
      if (turn.failed) return fail(`选择卡回合 sidecar 停了：${turn.error || 'engine stopped'}`)
      const later = await driver.waitForTurn(conversation.id, 8_000).catch(() => turn)
      const names = [...toolNames, ...collectToolNames(later?.events)]
      const snap = await pageSnapshot(driver)
      const card = snapshotHas(snap, ['其他', 'Other'])
      const tool = names.some(name => ASK_PATTERN.test(name))
      const ask = conversation.pendingAsk || pendingAskOf(
        (await driver.listConversations()).find(row => conversationIdOf(row) === conversation.id),
      )
      return ask || card || tool
        ? pass(ask ? '对话里出现了待回答的选择卡' : card ? '对话里出现了选择卡' : 'Pi 调用了 milksu_ask')
        : fail(`选择卡没出现 timeout=${Boolean(later?.timeout ?? turn.timeout)} card=${card} tool=${tool}`)
    },
  })
}

export async function runCodingPiAskContinue(driver, options = {}) {
  await home(driver)
  return runWorkspaceTurn(driver, {
    ...options,
    prefix: 'product-loop-pi-ask-continue',
    title: 'product-loop coding-pi-ask-continue',
    kernel: 'pi',
    prompt: ASK_PROMPT,
    skipWait: true,
    async afterSend(conversation) {
      let ask = await waitForPendingAsk(driver, conversation.id, 60_000)
      if (!ask) {
        const listed = await driver.listConversations()
        const saved = listed.find(row => conversationIdOf(row) === conversation.id)
        const workspace = String(saved?.workspacePath ?? saved?.WorkspacePath ?? '')
        const model = await turnModelOptions(driver)
        await driver.sendMessage(conversation.id, ASK_PROMPT, workspace, model).catch(() => {})
        ask = await waitForPendingAsk(driver, conversation.id, 60_000)
      }
      if (!ask) {
        conversation.askError = '选择卡没有停下来等回答'
        return
      }
      await driver.invoke('RespondToolApproval', [conversation.id, ask.requestId, true, 'once', 'other:CONTINUE-OK'])
      conversation.continued = await driver.waitForTurn(conversation.id, options.taskTimeoutMs || 180_000)
      if (turnBroken(conversation.continued)) {
        const listed = await driver.listConversations()
        const saved = listed.find(row => conversationIdOf(row) === conversation.id)
        const workspace = String(saved?.workspacePath ?? saved?.WorkspacePath ?? '')
        const model = await turnModelOptions(driver)
        await driver.sendMessage(conversation.id, 'CONTINUE-OK', workspace, model).catch(() => {})
        conversation.continued = await driver.waitForTurn(conversation.id, options.taskTimeoutMs || 180_000)
      }
    },
    async check({ conversation }) {
      if (conversation.askError) return fail(conversation.askError)
      const turn = conversation.continued
      const broken = turnBroken(turn)
      if (broken) return fail(`答完选择卡后回合异常：${broken}`)
      return pass('答完选择卡后同一回合继续跑完了')
    },
  })
}

export async function runCodingCite(driver, options = {}) {
  await home(driver)
  const workspace = await prepareWorkspace('product-loop-cite')
  const marker = `QUOTE-SRC-${Date.now().toString(36)}`
  let conversation = null
  try {
    conversation = await createTurn(driver, {
      title: 'product-loop coding-cite',
      workspace,
      kernel: 'pi',
      prompt: `请在回复里原样写出 ${marker}。不要调用工具。`,
    })
    const seeded = await driver.waitForTurn(conversation.id, options.taskTimeoutMs || 180_000)
    const broken = turnBroken(seeded)
    if (broken) return fail(`引用源回合没完成：${broken}`)
    const listedAfterSeed = await driver.listConversations()
    const savedSeed = listedAfterSeed.find(row => conversationIdOf(row) === conversation.id)
    const openTitle = String(savedSeed?.title ?? savedSeed?.Title ?? conversation.title)
    if (!await openConversation(driver, openTitle) && !await openConversation(driver, conversation.title)) {
      return fail('打不开这条会话')
    }
    const visible = await waitFor(async () => {
      const snap = await pageSnapshot(driver)
      return snapshotHas(snap, [marker]) ? true : null
    }, 8_000)
    if (!visible) return fail('对话正文里还没有标记，选不了')
    if (!await quoteConversationText(driver, marker)) {
      return fail('没能选中对话正文并点加入对话')
    }
    await delay(250)
    const quoted = snapshotHas(await pageSnapshot(driver), [marker])
    if (!quoted) return fail('点了加入对话，作曲栏上方没有引用')
    const question = '这段引用里的标记是什么？在回复里写 CITE-OK。'
    if (!await fillComposer(driver, question)) return fail('作曲栏写不进去')
    if (!await sendComposer(driver)) return fail('作曲栏发送没点到')
    const turn = await driver.waitForTurn(conversation.id, options.taskTimeoutMs || 180_000)
    if (turnBroken(turn)) return fail(`引用发出去后回合异常：${turnBroken(turn)}`)
    const listed = await driver.listConversations()
    const saved = listed.find(row => conversationIdOf(row) === conversation.id)
    const sent = conversationMessages(saved).some(message => {
      const text = String(message?.content ?? message?.Content ?? '')
      return text.includes(marker) && (text.includes(QUOTE_BLOCK_OPEN) || text.includes('>') || text.includes(question))
    })
    return sent
      ? pass('选中对话正文加入对话后发出去了')
      : fail('引用没进回合')
  } finally {
    await releaseProductLoopWorkspace(driver, conversation, workspace)
  }
}

export async function runCodingAttach(driver, options = {}) {
  await home(driver)
  const workspace = await prepareWorkspace('product-loop-attach')
  let conversation = null
  try {
    const model = await turnModelOptions(driver)
    const imported = await driver.invoke('ImportCodingAttachments', [[{
      name: 'loop-attach.txt',
      mediaType: 'text/plain',
      dataBase64: Buffer.from('PRODUCT-LOOP-ATTACH\n', 'utf8').toString('base64'),
    }]])
    const attachments = Array.isArray(imported) ? imported : []
    if (!attachments.length) return fail('ImportCodingAttachments 没有留下附件')
    conversation = await driver.createConversation({
      title: 'product-loop coding-attach',
      workspacePath: workspace,
      kernel: 'pi',
      approvalPolicy: 'workspace-auto',
      ...model,
    })
    const attachPrompt = '请读取附件 loop-attach.txt，在回复里原样写出 PRODUCT-LOOP-ATTACH。不要假装读过。'
    await driver.sendMessage(conversation.id, attachPrompt, workspace, { ...model, attachments })
    let turn = await driver.waitForTurn(conversation.id, options.taskTimeoutMs || 180_000)
    const inspect = async () => {
      const listed = await driver.listConversations()
      const saved = listed.find(row => conversationIdOf(row) === conversation.id)
      const attached = conversationMessages(saved).some(message => {
        const files = message?.attachments || message?.Attachments || []
        return Array.isArray(files) && files.some(file => String(file?.name ?? file?.Name ?? '').includes('loop-attach'))
      })
      const hay = JSON.stringify(turn.events ?? [])
      const mentioned = hay.includes('PRODUCT-LOOP-ATTACH')
        || hay.includes('loop-attach.txt')
        || conversationMessages(saved).some(message => String(message?.content ?? '').includes('PRODUCT-LOOP-ATTACH'))
      return { attached, mentioned, saved }
    }
    let seen = await inspect()
    if (!seen.mentioned) {
      await driver.sendMessage(
        conversation.id,
        '附件 loop-attach.txt 已经在当前回合里。先 read 它，再原样写出 PRODUCT-LOOP-ATTACH。',
        workspace,
        { ...model, attachments },
      )
      turn = await driver.waitForTurn(conversation.id, options.taskTimeoutMs || 180_000)
      seen = await inspect()
    }
    const broken = turnBroken(turn)
    if (broken) return fail(`附件回合异常：${broken}`)
    if (seen.mentioned) {
      return pass(seen.attached ? '附件进了当前回合，模型读到了标记' : '模型读到了附件标记')
    }
    return fail(`附件回合失败 attached=${seen.attached} mentioned=${seen.mentioned}`)
  } finally {
    await releaseProductLoopWorkspace(driver, conversation, workspace)
  }
}

export async function runCodingPiHandoff(driver) {
  await home(driver)
  const live = await startLiveSession(driver, {
    prefix: 'product-loop-pi-handoff',
    title: 'product-loop coding-pi-handoff',
    kernel: 'pi',
  })
  try {
    const broken = turnBroken(live.turn)
    if (broken) return fail(`接到新会话前 Pi 回合没完成：${broken}`)
    const result = await driver.invoke('HandoffCodingSession', [live.conversation.id, 'dsh'])
    const sessionId = String(result?.sessionId ?? result?.SessionID ?? '')
    if (!sessionId || sessionId === live.conversation.id) {
      return fail('接到新会话没有给出新会话 id')
    }
    const handed = {
      ...live.conversation,
      id: sessionId,
      kernel: 'dsh',
      title: `接力 · ${live.conversation.title}`.slice(0, 40),
      createdAt: Date.now(),
    }
    await driver.invoke('SaveConversation', [handed])
    driver.createdConversationIds.add(sessionId)
    const listed = await driver.listConversations()
    const saved = listed.find(row => conversationIdOf(row) === sessionId)
    const kernel = String(saved?.kernel ?? saved?.Kernel ?? '')
    return kernel === 'dsh'
      ? pass('整理后开出了新的 DSH 会话')
      : fail(`新会话 kernel=${kernel || '(empty)'}`)
  } catch (error) {
    return fail(`接到新会话失败：${error instanceof Error ? error.message : error}`)
  } finally {
    await releaseProductLoopWorkspace(driver, live.conversation, live.workspace)
  }
}

export async function runCodingDshFiles(driver, options = {}) {
  await home(driver)
  return runWorkspaceTurn(driver, {
    ...options,
    prefix: 'product-loop-dsh-files',
    title: 'product-loop coding-dsh-files',
    kernel: 'dsh',
    prompt: CODING_FILE_PROMPT,
    async check({ workspace, turn, toolNames }) {
      const notes = await fileExists(join(workspace, 'NOTES.md'))
      const ok = notes && toolNames.some(name => FILE_TOOL_PATTERN.test(name)) && !turn.timeout
      return ok ? pass('DSH 写出 NOTES.md，并且用了文件工具') : fail(`NOTES.md=${notes} tools=${toolNames.join(',')} timeout=${Boolean(turn.timeout)}`)
    },
  })
}

export async function runCodingDshShell(driver, options = {}) {
  await home(driver)
  return runWorkspaceTurn(driver, {
    ...options,
    prefix: 'product-loop-dsh-shell',
    title: 'product-loop coding-dsh-shell',
    kernel: 'dsh',
    prompt: SHELL_PROMPT,
    async check({ workspace, turn, toolNames }) {
      const wrote = await fileExists(join(workspace, 'DATE.txt'))
      const used = toolNames.some(name => SHELL_TOOL_PATTERN.test(name) || FILE_TOOL_PATTERN.test(name))
      const ok = wrote && used && !turn.timeout
      return ok ? pass('DSH 写出 DATE.txt') : fail(`DATE.txt=${wrote} tools=${used} timeout=${Boolean(turn.timeout)}`)
    },
  })
}

export async function runCodingDshQueue(driver, options = {}) {
  await home(driver)
  return runWorkspaceTurn(driver, {
    ...options,
    prefix: 'product-loop-dsh-queue',
    title: 'product-loop coding-dsh-queue',
    kernel: 'dsh',
    prompt: LONG_PROMPT,
    async afterSend(conversation) {
      const live = await waitForTurnStarted(driver, conversation.id, 25_000)
      if (live.failed) throw new Error(live.error || 'engine stopped')
      if (!live.started) throw new Error('DSH 主回合还没开始，排队没有对象')
      let lastError = ''
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          await driver.invoke('QueueDshMessage', [conversation.id, '排队：结束后在回复里写 QUEUE-OK。'])
          return
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error)
          if (!/not ready/i.test(lastError)) throw error
          await delay(700)
        }
      }
      throw new Error(lastError || 'DeepSeek Harness session is not ready')
    },
    async check({ turn }) {
      const broken = turnBroken(turn)
      if (broken) return fail(`排队后回合异常结束：${broken}`)
      return pass('DSH 忙碌时排队已经送达')
    },
  })
}

export async function runCodingDshPlan(driver) {
  await home(driver)
  const live = await startLiveSession(driver, {
    prefix: 'product-loop-dsh-plan',
    title: 'product-loop coding-dsh-plan',
    kernel: 'dsh',
  })
  try {
    const broken = turnBroken(live.turn)
    if (broken) return fail(`计划模式前 DSH 会话没起来：${broken}`)
    const mode = await driver.invoke('SetDshPlanMode', [live.conversation.id, true])
    const active = mode?.active === true || mode?.Active === true || mode === true
    return active ? pass('DSH 计划模式打开了') : fail(`计划模式回执 ${JSON.stringify(mode ?? {})}`)
  } catch (error) {
    return fail(`计划模式没打开：${error instanceof Error ? error.message : error}`)
  } finally {
    await releaseProductLoopWorkspace(driver, live.conversation, live.workspace)
  }
}

export async function runCodingDshGoal(driver) {
  await home(driver)
  const live = await startLiveSession(driver, {
    prefix: 'product-loop-dsh-goal',
    title: 'product-loop coding-dsh-goal',
    kernel: 'dsh',
  })
  try {
    const broken = turnBroken(live.turn)
    if (broken) return fail(`设目标前 DSH 会话没起来：${broken}`)
    await driver.invoke('ControlDshGoal', [live.conversation.id, 'create', 'product-loop 只确认目标控件能设上'])
    return pass('DSH 目标已经设上')
  } catch (error) {
    return fail(`DSH 目标没设上：${error instanceof Error ? error.message : error}`)
  } finally {
    await releaseProductLoopWorkspace(driver, live.conversation, live.workspace)
  }
}

export async function runCodingDshMultitask(driver, options = {}) {
  await home(driver)
  const workspace = await prepareWorkspace('product-loop-dsh-multitask')
  let parent = null
  try {
    const model = await turnModelOptions(driver)
    parent = await driver.createConversation({
      title: 'product-loop-dsh-parent',
      workspacePath: workspace,
      kernel: 'dsh',
      multitask: true,
      approvalPolicy: 'workspace-auto',
      ...model,
    })
    if (!await openConversation(driver, parent.title)) return fail('打不开 DSH 并行父会话')
    await dismissOverlays(driver)
    await clickAria(driver, ['添加内容与工具', 'Add content and tools'], '.chat-composer').catch(() => false)
    await delay(150)
    await clickLabeled(driver, ['并行', 'Multitask']).catch(() => false)
    await dismissOverlays(driver)
    await driver.sendMessage(parent.id, LONG_PROMPT, workspace, {
      ...model,
      approvalPolicy: 'workspace-auto',
    })
    const live = await waitForTurnStarted(driver, parent.id, 20_000)
    if (live.failed) return fail(`主回合还没跑起来 sidecar 就停了：${live.error || 'engine stopped'}`)
    if (!live.started) return fail('主回合没有开始，第二条发出去也不是并行')
    if (!await openConversation(driver, parent.title)) return fail('主回合开始后父会话不再是当前会话')
    await dismissOverlays(driver)
    const childPrompt = '这是并行子会话。只回一句 MULTITASK-CHILD。'
    if (!await fillComposer(driver, childPrompt)) return fail('忙碌时作曲栏写不进下一条')
    if (!await sendComposer(driver)) return fail('忙碌时第二条没发出去')
    const started = Date.now()
    let child = null
    while (Date.now() - started < (options.taskTimeoutMs || 60_000)) {
      const listed = await driver.listConversations()
      child = listed.find(row => parentConversationIdOf(row) === parent.id)
      if (child) break
      await delay(400)
    }
    if (!child) return fail('DSH 并行没有开出带父会话的 ACP 子会话')
    driver.createdConversationIds.add(conversationIdOf(child))
    return pass('DSH 并行开出了子会话')
  } finally {
    await releaseProductLoopWorkspace(driver, parent, workspace)
  }
}

export async function runCodingDshStop(driver, options = {}) {
  await home(driver)
  return runWorkspaceTurn(driver, {
    ...options,
    prefix: 'product-loop-dsh-stop',
    title: 'product-loop coding-dsh-stop',
    kernel: 'dsh',
    prompt: LONG_PROMPT,
    async afterSend(conversation) {
      await delay(600)
      await driver.abortMessage(conversation.id)
    },
    async check({ turn }) {
      if (turn.failed) return fail(`DSH 停止时 sidecar 停了：${turn.error || 'engine stopped'}`)
      if (!turn.timeout || turnAborted(turn.events)) {
        return pass('DSH 停止后回合结束了，或收到了中止回执')
      }
      return fail('DSH 停止之后回合既没结束也没有中止回执')
    },
  })
}

export async function runCodingDshCompact(driver, options = {}) {
  await home(driver)
  return runWorkspaceTurn(driver, {
    ...options,
    prefix: 'product-loop-dsh-compact',
    title: 'product-loop coding-dsh-compact',
    kernel: 'dsh',
    prompt: CODING_FILE_PROMPT,
    async check({ conversation, turn }) {
      const broken = turnBroken(turn)
      if (broken) return fail(`写文件回合没完成，没法整理上下文：${broken}`)
      try {
        await driver.invoke('CompactCodingSession', [conversation.id])
      } catch (error) {
        return fail(`DSH 整理上下文没发出去：${error instanceof Error ? error.message : error}`)
      }
      return pass('DSH 回合后整理上下文已经发出')
    },
  })
}

export async function runSessionNew(driver) {
  const opened = await home(driver)
  if (!opened.ok) return fail(opened.detail)
  await dismissOverlays(driver)
  const plus = await clickLabeled(driver, ['新会话', 'New chat'])
  await delay(300)
  const snap = await pageSnapshot(driver)
  return plus && isNewConversationCanvas(snap)
    ? pass('加号打开了新会话画布')
    : fail('加号没有打开新会话画布')
}

export async function runSessionPin(driver) {
  await home(driver)
  const prefix = `loop-pin-${Date.now().toString(36)}`
  const first = await driver.createConversation({ id: `${prefix}-a`, title: `${prefix}-a`, pinned: true, pinnedOrder: 0, kernel: 'pi' })
  const second = await driver.createConversation({ id: `${prefix}-b`, title: `${prefix}-b`, pinned: true, pinnedOrder: 1, kernel: 'pi' })
  const listed = await driver.listConversations()
  const byId = new Map(listed.map(row => [String(row.id ?? row.ID ?? ''), row]))
  const a = byId.get(first.id)
  const b = byId.get(second.id)
  const ok = (a?.pinned === true || a?.Pinned === true)
    && (b?.pinned === true || b?.Pinned === true)
    && Number(a?.pinnedOrder ?? a?.PinnedOrder) === 0
    && Number(b?.pinnedOrder ?? b?.PinnedOrder) === 1
  return ok ? pass('两条会话钉住了，顺序还在') : fail('钉选顺序没有存回来')
}

export async function runSessionRename(driver) {
  await home(driver)
  const conversation = await driver.createConversation({ title: 'product-loop-rename-src', kernel: 'pi' })
  await driver.invoke('SaveConversation', [{
    ...conversation,
    title: 'product-loop-renamed',
  }])
  const listed = await driver.listConversations()
  const saved = listed.find(row => String(row.id ?? row.ID) === conversation.id)
  return String(saved?.title ?? saved?.Title) === 'product-loop-renamed'
    ? pass('会话改名已经留下')
    : fail('重命名没有存回来')
}

export async function runSessionFork(driver) {
  await home(driver)
  const live = await startLiveSession(driver, {
    prefix: 'product-loop-fork',
    title: 'product-loop-fork-src',
    kernel: 'pi',
  })
  try {
    const broken = turnBroken(live.turn)
    if (broken) return fail(`Fork 前会话没起来：${broken}`)
    const forked = await driver.invoke('ForkConversation', [live.conversation.id, 'user', 0])
    const id = String(forked?.id ?? forked?.ID ?? forked ?? '')
    if (!id || id === live.conversation.id) return fail('Fork 没有给出新会话')
    driver.createdConversationIds.add(id)
    return pass('Fork 出了一条新会话')
  } catch (error) {
    return fail(`Fork 失败：${error instanceof Error ? error.message : error}`)
  } finally {
    await releaseProductLoopWorkspace(driver, live.conversation, live.workspace)
  }
}

export async function runSessionArchive(driver) {
  await home(driver)
  const conversation = await driver.createConversation({ title: 'product-loop-archive', kernel: 'pi' })
  await driver.archiveConversation(conversation.id)
  const moved = conversationMovedToArchive(
    await driver.listConversations(),
    await driver.listArchivedConversations(),
    conversation.id,
  )
  if (!moved.ok) return fail(moved.reason)
  await driver.deleteArchivedConversation(conversation.id)
  return pass('归档后立刻离开活动列表')
}

export async function runSessionDelete(driver) {
  await home(driver)
  const conversation = await driver.createConversation({ title: 'product-loop-delete', kernel: 'pi' })
  await driver.deleteConversation(conversation.id)
  const listed = await driver.listConversations()
  const still = listed.some(row => String(row.id ?? row.ID) === conversation.id)
  return still ? fail('删除后会话还在活动列表') : pass('会话已经删掉')
}

export async function runSessionCommandPanel(driver) {
  await home(driver)
  const clicked = await clickLabeled(driver, ['搜索任务', 'Search tasks'])
  await delay(300)
  if (!clicked) {
    await driver.cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      modifiers: 2,
      key: 'k',
      windowsVirtualKeyCode: 75,
    }).catch(() => {})
    await delay(250)
  }
  const result = await expectLabels(driver, ['搜索会话、设置或命令', 'Search chats, settings, or commands', '全部', 'All'], '命令面板打开了', '命令面板没打开')
  await dismissOverlays(driver)
  return result
}

export async function runComposerModel(driver) {
  await home(driver)
  await dismissOverlays(driver)
  await clickLabeled(driver, ['新会话', 'New chat']).catch(() => false)
  await delay(250)
  if (!await clickAria(driver, ['选择本任务模型', 'Choose a model for this task'], '.chat-composer')) {
    return fail('点不到作曲栏模型芯片')
  }
  await delay(250)
  return expectLabels(
    driver,
    ['模型', 'Model', '运行时', 'Runtime', '上下文', 'Context'],
    '模型芯片打开了模型和运行时',
    '模型芯片打开后看不到模型或运行时',
  )
}

export async function runComposerRuntime(driver) {
  await home(driver)
  await dismissOverlays(driver)
  await clickLabeled(driver, ['新会话', 'New chat']).catch(() => false)
  await delay(250)
  await dismissOverlays(driver)
  if (!await clickAria(driver, ['选择本任务模型', 'Choose a model for this task'], '.chat-composer')) {
    return fail('点不到作曲栏模型芯片')
  }
  const menu = await waitFor(async () => {
    const snap = await pageSnapshot(driver)
    return snapshotHas(snap, ['运行时', 'Runtime']) ? true : null
  }, 2_500)
  if (!menu) return fail('模型菜单里没有运行时')
  const runtimeReady = await waitFor(async () => {
    const hovered = await hoverLabeled(driver, ['运行时', 'Runtime'])
    const clicked = hovered || await clickLabeled(driver, ['运行时', 'Runtime'])
    return clicked ? true : null
  }, 4_000)
  if (!runtimeReady) return fail('模型菜单里没有运行时')
  await delay(250)
  return expectLabels(
    driver,
    ['Pi', 'DeepSeek Harness', 'DSH'],
    '运行时飞出面板里看得见 Pi / DSH',
    '运行时飞出面板没出来',
  )
}

export async function runComposerGit(driver) {
  await home(driver)
  const workspace = await prepareWorkspace('product-loop-git')
  let conversation = null
  try {
    conversation = await driver.createConversation({
      title: 'product-loop-composer-git',
      workspacePath: workspace,
      kernel: 'pi',
    })
    if (!await openConversation(driver, conversation.title)) return fail('打不开带仓库的会话')
    await dismissOverlays(driver)
    await delay(600)
    const opened = await clickAria(driver, ['当前分支', 'Current branch', '分支', 'Branch'], '.chat-composer')
    if (!opened) return fail('这条会话没有 Git 芯片。工作区必须是 Git 仓库')
    await delay(250)
    return expectLabels(
      driver,
      ['创建分支', 'Create Branch', '搜索分支', 'Search branches'],
      'Git 芯片能打开分支菜单',
      '打不开作曲栏 Git',
    )
  } finally {
    await releaseProductLoopWorkspace(driver, conversation, workspace)
  }
}

export async function runComposerPlus(driver) {
  await home(driver)
  await dismissOverlays(driver)
  await clickLabeled(driver, ['新会话', 'New chat']).catch(() => false)
  await delay(250)
  await dismissOverlays(driver)
  const openedPlus = await waitFor(() => pageCallComposerPlus(driver), 4_000)
  if (!openedPlus) return fail('点不到作曲栏加号')
  const menu = await waitFor(async () => {
    const snap = await pageSnapshot(driver)
    return snapshotHas(snap, ['本机文件或图片', 'Local files or images', '并行', 'Multitask', '目标', 'Goal'])
      ? true
      : null
  }, 2_500)
  return menu
    ? pass('作曲栏加号菜单打开了')
    : fail('作曲栏加号菜单没打开')
}

async function pageCallComposerPlus(driver) {
  return driver.cdp.callFunction(`function() {
    const roots = Array.from(document.querySelectorAll('.chat-composer'))
    const visible = roots.find(root => {
      const box = root.getBoundingClientRect()
      return box.width > 1 && box.height > 1
    }) || roots[0]
    if (!visible) return false
    const button = visible.querySelector('[aria-label="添加内容与工具"], [aria-label="Add content and tools"]')
    if (!button || button.disabled) return false
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    button.click()
    return true
  }`)
}

export async function runRailOpen(driver) {
  await home(driver)
  const conversation = await driver.createConversation({ title: 'product-loop-rail', kernel: 'pi' })
  await clickLabeled(driver, [conversation.title]).catch(() => false)
  await delay(250)
  await clickLabeled(driver, ['打开右侧栏', 'Open right rail']).catch(() => false)
  await delay(250)
  return expectLabels(
    driver,
    ['调整右侧栏宽度', 'Resize the right panel', '打开右侧栏', 'Open right rail', '环境', 'Environment', '浏览器', 'Browser'],
    '右侧栏打得开',
    '右侧栏没看见',
  )
}

export async function runTerminalOpen(driver) {
  await home(driver)
  const conversation = await driver.createConversation({ title: 'product-loop-terminal', kernel: 'pi' })
  await clickLabeled(driver, [conversation.title]).catch(() => false)
  await delay(250)
  await clickLabeled(driver, ['打开底部终端', 'Open bottom terminal']).catch(() => false)
  await delay(250)
  return expectLabels(
    driver,
    ['底部终端面板', 'Bottom terminal panel', '关闭底部终端', 'Close bottom terminal'],
    '底部终端打得开',
    '底部终端没看见',
  )
}

export async function runSessionContextMenu(driver) {
  await home(driver)
  await dismissOverlays(driver)
  const conversation = await driver.createConversation({ title: `loop-menu-${Date.now().toString(36)}`, kernel: 'pi' })
  await delay(400)
  const openedMenu = await waitFor(async () => {
    await revealConversationRows(driver)
    if (!await findConversationRow(driver, conversation.title)) return false
    return driver.cdp.callFunction(`function(title) {
      const row = Array.from(document.querySelectorAll('.agent-sidebar-item')).find(item => (item.textContent || '').includes(title))
      if (!row) return false
      const box = row.getBoundingClientRect()
      row.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: box.left + 24,
        clientY: box.top + 12,
      }))
      return true
    }`, [conversation.title])
  }, 8_000)
  if (!openedMenu) return fail('侧栏里找不到刚开的会话行')
  await delay(250)
  return expectLabels(
    driver,
    ['置顶', 'Pin', '重命名', 'Rename', 'Fork', '归档', 'Archive', '删除', 'Delete'],
    '会话右键能看到完整动作',
    '会话右键菜单没出来',
  )
}

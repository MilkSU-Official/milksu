/**
 * Homepage Coding: Pi / DSH daily turns and session chrome.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { delay, repositoryRoot } from './desktop-gui-driver.mjs'
import { conversationMovedToArchive } from './product-loop-companion.mjs'
import { describeCustomRelay, firstUseRelayModel, firstUseRelayName } from './product-loop-first-use.mjs'
import {
  clickLabeled,
  expectLabels,
  fail,
  fillComposer,
  leaveSettings,
  openWorkspace,
  pageSnapshot,
  pass,
  quoteConversationText,
  sendComposer,
  snapshotHas,
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
  '请调用 milksu_ask，问我下一步怎么走。给出 2 到 4 个具体选项，最后一行必须是其他 / Other。',
  '问完就停，等我选。',
].join('\n')

const LONG_PROMPT = [
  '请慢慢做：先列出工作区，再写一份很长的 LOOP.md，至少写八段，每段三句话，然后读回来。',
  '中途如果收到插话或停止，按产品规则处理。',
].join('\n')

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

async function home(driver) {
  await leaveSettings(driver)
  return openWorkspace(driver, ['主页', 'Home'])
}

async function createTurn(driver, options) {
  const settings = await driver.invoke('GetSettings', []).catch(() => ({}))
  const relay = relayOptions(settings)
  const conversation = await driver.createConversation({
    title: options.title,
    workspacePath: options.workspace,
    kernel: options.kernel || 'pi',
    approvalPolicy: 'workspace-auto',
    executionMode: options.executionMode || 'go',
    ...relay,
  })
  await driver.sendMessage(conversation.id, options.prompt, options.workspace, {
    ...relay,
    executionMode: options.executionMode || 'go',
    approvalPolicy: 'workspace-auto',
  })
  return conversation
}

async function runWorkspaceTurn(driver, options) {
  const workspace = await prepareWorkspace(options.prefix, options.extraFiles)
  try {
    const conversation = await createTurn(driver, { ...options, workspace })
    if (options.afterSend) await options.afterSend(conversation, workspace)
    const turn = options.skipWait
      ? { events: [], timeout: false }
      : await driver.waitForTurn(conversation.id, options.timeoutMs || 180_000)
    const toolNames = collectToolNames(turn.events)
    const check = await options.check({ conversation, workspace, turn, toolNames })
    return { ...check, toolNames }
  } finally {
    if (!options.keepWorkspace) await rm(workspace, { recursive: true, force: true }).catch(() => {})
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
      if (turn.timeout) return fail('写文件回合超时，没法整理上下文')
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
      return turn.timeout ? fail('插话后回合没有结束') : pass('Pi 忙碌时插话已经送达并结束回合')
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
      conversation.pendingAsk = await waitForPendingAsk(driver, conversation.id)
    },
    async check({ conversation, turn, toolNames }) {
      const snap = await pageSnapshot(driver)
      const card = snapshotHas(snap, ['其他', 'Other'])
      const tool = toolNames.some(name => ASK_PATTERN.test(name))
      const ask = conversation.pendingAsk || pendingAskOf(
        (await driver.listConversations()).find(row => conversationIdOf(row) === conversation.id),
      )
      return ask || card || tool
        ? pass(ask ? '对话里出现了待回答的选择卡' : card ? '对话里出现了选择卡' : 'Pi 调用了 milksu_ask')
        : fail(`选择卡没出现 timeout=${Boolean(turn.timeout)} card=${card} tool=${tool}`)
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
      const ask = await waitForPendingAsk(driver, conversation.id, options.taskTimeoutMs || 90_000)
      if (!ask) {
        conversation.askError = '选择卡没有停下来等回答'
        return
      }
      await driver.invoke('RespondToolApproval', [conversation.id, ask.requestId, true, 'once', 'other:CONTINUE-OK'])
      conversation.continued = await driver.waitForTurn(conversation.id, options.taskTimeoutMs || 180_000)
    },
    async check({ conversation }) {
      if (conversation.askError) return fail(conversation.askError)
      const turn = conversation.continued
      if (!turn || turn.timeout) return fail('答完选择卡后同一回合没有继续结束')
      return pass('答完选择卡后同一回合继续跑完了')
    },
  })
}

export async function runCodingCite(driver, options = {}) {
  await home(driver)
  const workspace = await prepareWorkspace('product-loop-cite')
  const marker = `QUOTE-SRC-${Date.now().toString(36)}`
  try {
    const settings = await driver.invoke('GetSettings', []).catch(() => ({}))
    const conversation = await driver.createConversation({
      title: 'product-loop coding-cite',
      workspacePath: workspace,
      kernel: 'pi',
      approvalPolicy: 'workspace-auto',
      ...relayOptions(settings),
    })
    await driver.invoke('SaveConversation', [{
      ...conversation,
      messages: [
        { id: `${conversation.id}-u`, role: 'user', content: `请记住这段 ${marker}`, timestamp: Date.now() },
        { id: `${conversation.id}-a`, role: 'assistant', content: `助手回复里有标记 ${marker}`, timestamp: Date.now() + 1, status: 'done' },
      ],
    }])
    await clickLabeled(driver, [conversation.title]).catch(() => false)
    await delay(400)
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
    const listed = await driver.listConversations()
    const saved = listed.find(row => conversationIdOf(row) === conversation.id)
    const sent = conversationMessages(saved).some(message => {
      const text = String(message?.content ?? message?.Content ?? '')
      return text.includes(marker) && (text.includes(QUOTE_BLOCK_OPEN) || text.includes('>') || text.includes(question))
    })
    return !turn.timeout && sent
      ? pass('选中对话正文加入对话后发出去了')
      : fail(`引用没进回合 timeout=${Boolean(turn.timeout)} sent=${sent}`)
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => {})
  }
}

export async function runCodingAttach(driver, options = {}) {
  await home(driver)
  const workspace = await prepareWorkspace('product-loop-attach')
  try {
    const settings = await driver.invoke('GetSettings', []).catch(() => ({}))
    const imported = await driver.invoke('ImportCodingAttachments', [[{
      name: 'loop-attach.txt',
      mediaType: 'text/plain',
      dataBase64: Buffer.from('PRODUCT-LOOP-ATTACH\n', 'utf8').toString('base64'),
    }]])
    const attachments = Array.isArray(imported) ? imported : []
    if (!attachments.length) return fail('ImportCodingAttachments 没有留下附件')
    const conversation = await driver.createConversation({
      title: 'product-loop coding-attach',
      workspacePath: workspace,
      kernel: 'pi',
      approvalPolicy: 'workspace-auto',
      ...relayOptions(settings),
    })
    await driver.sendMessage(
      conversation.id,
      '请读取附件 loop-attach.txt，在回复里原样写出 PRODUCT-LOOP-ATTACH。不要假装读过。',
      workspace,
      { ...relayOptions(settings), attachments },
    )
    const turn = await driver.waitForTurn(conversation.id, options.taskTimeoutMs || 180_000)
    const listed = await driver.listConversations()
    const saved = listed.find(row => conversationIdOf(row) === conversation.id)
    const attached = conversationMessages(saved).some(message => {
      const files = message?.attachments || message?.Attachments || []
      return Array.isArray(files) && files.some(file => String(file?.name ?? file?.Name ?? '').includes('loop-attach'))
    })
    const mentioned = JSON.stringify(turn.events ?? []).includes('PRODUCT-LOOP-ATTACH')
      || conversationMessages(saved).some(message => String(message?.content ?? '').includes('PRODUCT-LOOP-ATTACH'))
    return !turn.timeout && attached && mentioned
      ? pass('附件进了当前回合，模型读到了标记')
      : fail(`附件回合失败 timeout=${Boolean(turn.timeout)} attached=${attached} mentioned=${mentioned}`)
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => {})
  }
}

export async function runCodingPiHandoff(driver) {
  await home(driver)
  const workspace = await prepareWorkspace('product-loop-pi-handoff')
  try {
    const settings = await driver.invoke('GetSettings', []).catch(() => ({}))
    const conversation = await driver.createConversation({
      title: 'product-loop coding-pi-handoff',
      workspacePath: workspace,
      kernel: 'pi',
      approvalPolicy: 'workspace-auto',
      ...relayOptions(settings),
    })
    const result = await driver.invoke('HandoffCodingSession', [conversation.id, 'dsh'])
    const kernel = String(result?.kernel ?? result?.Kernel ?? result?.session?.kernel ?? '')
    const listed = await driver.listConversations()
    const saved = listed.find(row => String(row.id ?? row.ID) === conversation.id)
    const next = String(saved?.kernel ?? saved?.Kernel ?? kernel)
    return next === 'dsh' || /dsh/i.test(JSON.stringify(result ?? {}))
      ? pass('这条会话已经接到 DSH')
      : fail(`接到新会话后 kernel=${next || '(empty)'}`)
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => {})
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
      await delay(700)
      await driver.invoke('QueueDshMessage', [conversation.id, '排队：结束后在回复里写 QUEUE-OK。'])
    },
    async check({ turn }) {
      return turn.timeout ? fail('排队后回合没有结束') : pass('DSH 忙碌时排队已经送达')
    },
  })
}

export async function runCodingDshPlan(driver) {
  await home(driver)
  const workspace = await prepareWorkspace('product-loop-dsh-plan')
  try {
    const settings = await driver.invoke('GetSettings', []).catch(() => ({}))
    const conversation = await driver.createConversation({
      title: 'product-loop coding-dsh-plan',
      workspacePath: workspace,
      kernel: 'dsh',
      approvalPolicy: 'workspace-auto',
      ...relayOptions(settings),
    })
    const mode = await driver.invoke('SetDshPlanMode', [conversation.id, true])
    const active = mode?.active === true || mode?.Active === true || mode === true
    return active ? pass('DSH 计划模式打开了') : fail(`计划模式回执 ${JSON.stringify(mode ?? {})}`)
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => {})
  }
}

export async function runCodingDshGoal(driver) {
  await home(driver)
  const workspace = await prepareWorkspace('product-loop-dsh-goal')
  try {
    const settings = await driver.invoke('GetSettings', []).catch(() => ({}))
    const conversation = await driver.createConversation({
      title: 'product-loop coding-dsh-goal',
      workspacePath: workspace,
      kernel: 'dsh',
      approvalPolicy: 'workspace-auto',
      ...relayOptions(settings),
    })
    await driver.invoke('ControlDshGoal', [conversation.id, 'set', 'product-loop 只确认目标控件能设上'])
    return pass('DSH 目标已经设上')
  } catch (error) {
    return fail(`DSH 目标没设上：${error instanceof Error ? error.message : error}`)
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => {})
  }
}

export async function runCodingDshMultitask(driver, options = {}) {
  await home(driver)
  const workspace = await prepareWorkspace('product-loop-dsh-multitask')
  try {
    const settings = await driver.invoke('GetSettings', []).catch(() => ({}))
    const parent = await driver.createConversation({
      title: 'product-loop-dsh-parent',
      workspacePath: workspace,
      kernel: 'dsh',
      multitask: true,
      approvalPolicy: 'workspace-auto',
      ...relayOptions(settings),
    })
    await clickLabeled(driver, [parent.title]).catch(() => false)
    await delay(250)
    await clickLabeled(driver, ['添加', 'Add', '加号']).catch(() => false)
    await delay(150)
    await clickLabeled(driver, ['并行', 'Multitask']).catch(() => false)
    await delay(200)
    if (!await fillComposer(driver, LONG_PROMPT)) return fail('主会话作曲栏写不进去')
    if (!await sendComposer(driver)) return fail('主会话没发出去')
    await delay(1200)
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
    await rm(workspace, { recursive: true, force: true }).catch(() => {})
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
      if (turn.timeout) return fail('写文件回合超时，没法整理上下文')
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
  const plus = await clickLabeled(driver, ['新会话', 'New chat'])
  await delay(300)
  const snap = await pageSnapshot(driver)
  return plus && snapshotHas(snap, ['我们要构建什么', 'What should we build'])
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
  const conversation = await driver.createConversation({ title: 'product-loop-fork-src', kernel: 'pi' })
  await driver.invoke('SaveConversation', [{
    ...conversation,
    messages: [{ id: `${conversation.id}-u`, role: 'user', content: 'fork source', timestamp: Date.now() }],
  }])
  const forked = await driver.invoke('ForkConversation', [conversation.id, 'user', 0])
  const id = String(forked?.id ?? forked?.ID ?? forked ?? '')
  if (!id || id === conversation.id) return fail('Fork 没有给出新会话')
  driver.createdConversationIds.add(id)
  return pass('Fork 出了一条新会话')
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
  return expectLabels(driver, ['搜索会话、设置或命令', 'Search chats, settings, or commands', '全部', 'All'], '命令面板打开了', '命令面板没打开')
}

export async function runComposerModel(driver) {
  await home(driver)
  await clickLabeled(driver, ['新会话', 'New chat']).catch(() => false)
  await delay(250)
  const snap = await pageSnapshot(driver)
  return snapshotHas(snap, ['模型', 'Model', '推理', 'Reasoning', '上下文', 'Context'])
    ? pass('作曲栏看得到模型相关控件')
    : fail('作曲栏看不到模型芯片')
}

export async function runComposerRuntime(driver) {
  await home(driver)
  await clickLabeled(driver, ['新会话', 'New chat']).catch(() => false)
  await delay(250)
  const snap = await pageSnapshot(driver)
  return snapshotHas(snap, ['Pi', 'DSH', '运行时', 'Runtime'])
    ? pass('作曲栏看得到运行时')
    : fail('作曲栏看不到 Pi / DSH')
}

export async function runComposerGit(driver) {
  await home(driver)
  await clickLabeled(driver, ['新会话', 'New chat']).catch(() => false)
  await delay(250)
  await clickLabeled(driver, ['分支', 'Branch', 'Git']).catch(() => false)
  await delay(250)
  return expectLabels(
    driver,
    ['创建分支', 'Create branch', '搜索', 'Search', 'main', 'master'],
    'Git 芯片能打开分支菜单',
    '打不开作曲栏 Git',
  )
}

export async function runComposerPlus(driver) {
  await home(driver)
  await clickLabeled(driver, ['新会话', 'New chat']).catch(() => false)
  await delay(250)
  await clickLabeled(driver, ['添加', 'Add', '加号']).catch(() => false)
  await delay(250)
  return expectLabels(
    driver,
    ['并行', 'Multitask', '附件', 'Attach', 'Skill', 'MCP', 'Computer Use', 'Browser'],
    '作曲栏加号菜单打开了',
    '作曲栏加号菜单没打开',
  )
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
  const conversation = await driver.createConversation({ title: `loop-menu-${Date.now().toString(36)}`, kernel: 'pi' })
  await driver.cdp.callFunction(`function(title) {
    const row = Array.from(document.querySelectorAll('button, [role="button"]')).find(item => (item.textContent || '').includes(title))
    if (!row) return false
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
    return true
  }`, [conversation.title])
  await delay(250)
  return expectLabels(
    driver,
    ['置顶', 'Pin', '重命名', 'Rename', 'Fork', '归档', 'Archive', '删除', 'Delete'],
    '会话右键能看到完整动作',
    '会话右键菜单没出来',
  )
}

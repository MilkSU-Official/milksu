#!/usr/bin/env node
/**
 * Product-regression coordinator.
 * Observes the product through official Desktop RPC.
 * Not Settings → 评测. Not imported by App startup.
 *
 *   npm run test:product-loop -- --list
 *   npm run test:product-loop -- --suite first-use
 *   npm run test:product-loop -- --gui --suite all
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { redactProcessText } from '../sidecar/dsh/redact.js'
import { repositoryRoot } from './lib/desktop-gui-driver.mjs'
import {
  CASES,
  DEFAULT_MODULES,
  MODULES,
  PRODUCT_LOOP_SCHEMA,
  TOKENFLUX_BASE_URL,
  finalizeProductLoopResult,
  groupCasesByModule,
  parseProductLoopArgs,
} from './lib/product-loop-catalog.mjs'
import {
  applyProductLoopLocalEnv,
  describeProductLoopLocalEnv,
} from './lib/product-loop-local-env.mjs'
import { runFirstUse, saveCustomRelay } from './lib/product-loop-first-use.mjs'
import { printProductLoopReport } from './lib/product-loop-report.mjs'
import { runProductLoopCase } from './lib/product-loop-runners.mjs'
import { ensureIsolatedProductSession } from './lib/product-loop-session.mjs'

const resultPath = join(repositoryRoot, 'build', 'test-results', 'product-loop.json')

async function writeReceipt(receipt) {
  await mkdir(dirname(resultPath), { recursive: true })
  await writeFile(resultPath, `${JSON.stringify(receipt, null, 2)}\n`)
}

function printHelp() {
  console.log(`MilkSU product-regression loop

  node scripts/verify-product-loop.mjs --list
  node scripts/verify-product-loop.mjs --suite first-use
  node scripts/verify-product-loop.mjs --gui --suite all

默认按上手顺序跑产品模块：上手 → 主页 Coding → 桌宠 → 领域工作区 → 桌面执行面 → 账户与更新 → 设置其余项。
独立实例贯穿，不附着已在首页的日常窗口。Key 打进设置密码框，不注入 sidecar。
结束后打印从大模块到小模块的报告。

模块：
${DEFAULT_MODULES.map(id => `  ${id.padEnd(16)} ${MODULES[id].title}  ${MODULES[id].cases.length} 项`).join('\n')}

独立 Stable（禁止 Beta）。本机 Key 填 docs/developer/product-loop.local.env。回执不写值。
回执 ${resultPath}
用法：docs/developer/product-regression-loop.md
`)
}

function printList() {
  for (const id of DEFAULT_MODULES) {
    const module = MODULES[id]
    console.log(`${module.id}\t${module.title}\t${module.cases.join(',')}\t${module.detail}`)
  }
}

function baseReceipt(options) {
  return {
    schemaVersion: PRODUCT_LOOP_SCHEMA,
    mode: options.mode,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    result: 'FAIL',
    tokenfluxBaseURL: TOKENFLUX_BASE_URL,
    family: 'product-regression',
    not: 'settings-evalsuite',
    gaps: [
      '协调器在 scripts/，不进 App 启动、不暴露测试专用 Desktop RPC。',
      '按上手顺序走独立实例。Key 只打进设置密码框，不注入 sidecar。',
      'Computer Use 缺权限记失败，不偷偷改走隔离浏览器。隔离浏览器自己测打开、跳转、点击、标签和读标记。',
      'GUI 测完走 DeleteConversation / DeleteArchivedConversation，清掉 product-loop fixture。',
      '禁止 desktop:start:beta / MilkSU Beta。',
    ],
    suites: [],
    modules: [],
    humanReview: [],
    eventsNote: 'no Provider keys',
    localEnv: { loaded: false, applied: [], unknown: [], publicValues: {} },
  }
}

async function main() {
  const options = parseProductLoopArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  if (options.list) {
    printList()
    return
  }

  const receipt = baseReceipt(options)
  const localEnv = await applyProductLoopLocalEnv(process.env)
  receipt.localEnv = describeProductLoopLocalEnv({ ...localEnv, env: process.env })
  const requestedCases = options.cases ?? []
  let session = { driver: null, instanceId: '', sourcesReady: false, ok: false }

  function recordCase(id, outcome) {
    const item = CASES[id]
    const record = {
      id,
      title: item?.title || id,
      module: item?.module || '',
      from: item ? MODULES[item.module]?.from : '',
      result: outcome.result,
      detail: redactProcessText(outcome.detail || '', 500),
      toolNames: outcome.toolNames,
      surface: outcome.surface,
      degraded: outcome.degraded,
      steps: outcome.steps,
    }
    receipt.suites.push(record)
    process.stdout.write(`CASE ${id} ${record.result} ${record.detail}\n`)
    return record
  }

  async function ensureProductSession() {
    session = await ensureIsolatedProductSession(session, options)
    if (!session.ok || !session.driver?.cdpAlive()) {
      receipt.gaps.push(session.detail || session.driver?.gaps?.join(' ') || '没附着独立产品窗口')
      return false
    }
    if (!session.sourcesReady) {
      const relay = await saveCustomRelay(session.driver)
      session.sourcesReady = relay.ok === true
      if (!relay.ok) receipt.humanReview.push(relay.detail || '中转站没配上')
    }
    return true
  }

  async function runProductCase(id) {
    const item = CASES[id]
    if (item?.needsCredential && !session.sourcesReady) {
      return { result: 'FAIL', detail: '中转站还不能发，主页发送不再 SKIP' }
    }
    return runProductLoopCase(id, session.driver, options)
  }

  try {
    for (const group of groupCasesByModule(requestedCases)) {
      process.stdout.write(`MODULE ${group.module.id} start ${group.module.title}\n`)
      if (group.module.id === 'first-use') {
        if (session.driver) {
          await session.driver.close().catch(() => {})
          session = { driver: null, instanceId: '', sourcesReady: false, ok: false }
        }
        const outcome = await runFirstUse({ ...options, keepOpen: true })
        if (outcome.notes?.length) receipt.humanReview.push(...outcome.notes)
        if (outcome.driver) {
          session = {
            driver: outcome.driver,
            instanceId: outcome.instanceId,
            sourcesReady: outcome.sourcesReady === true,
            ok: true,
          }
        }
        const produced = new Set((outcome.steps ?? []).map(step => step.id))
        const optional = new Set(['login-github-active', 'account-model-fileloop'])
        for (const item of group.cases) {
          const step = (outcome.steps ?? []).find(row => row.id === item.id)
          if (step) {
            recordCase(item.id, step)
            continue
          }
          if (optional.has(item.id)) {
            recordCase(item.id, { result: 'SKIP', detail: '这次没走到账户登录' })
            continue
          }
          if (produced.size && !produced.has(item.id)) {
            recordCase(item.id, { result: 'FAIL', detail: '上手流程没跑到这一步' })
            continue
          }
          recordCase(item.id, { result: outcome.result, detail: outcome.detail })
        }
        continue
      }

      for (const item of group.cases) {
        let outcome
        try {
          const ready = await ensureProductSession()
          if (!ready) {
            outcome = { result: 'FAIL', detail: session.detail || '没附着独立产品窗口' }
          } else {
            outcome = await runProductCase(item.id)
          }
        } catch (error) {
          const message = redactProcessText(error instanceof Error ? error.message : error, 400)
          receipt.humanReview.push(message)
          outcome = { result: 'FAIL', detail: message }
        }
        recordCase(item.id, outcome)
      }
    }
  } catch (error) {
    const message = redactProcessText(error instanceof Error ? error.message : error, 400)
    receipt.humanReview.push(message)
    for (const id of requestedCases) {
      if (receipt.suites.some(row => row.id === id)) continue
      recordCase(id, { result: 'FAIL', detail: message })
    }
  } finally {
    if (session.driver) await session.driver.close()
  }

  receipt.finishedAt = new Date().toISOString()
  receipt.result = finalizeProductLoopResult(receipt.suites, requestedCases, receipt.humanReview)
  const report = printProductLoopReport(receipt)
  receipt.report = {
    modules: report.modules.map(item => ({ id: item.id, title: item.title, result: item.result, total: item.total, passed: item.passed, failed: item.failed, skipped: item.skipped })),
    overall: report.overall,
  }
  await writeReceipt(receipt)
  console.log(`receipt ${resultPath}`)
  process.exitCode = receipt.result === 'PASS' ? 0 : 1
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) {
  await main()
}

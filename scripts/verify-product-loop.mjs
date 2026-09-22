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
import { enablePersonalRelayRoute, runFirstUse, saveCustomRelay } from './lib/product-loop-first-use.mjs'
import {
  captureProductLoopEvidenceBundle,
  printProductLoopReport,
  resetProductLoopReportDir,
  writeFormalProductLoopReport,
} from './lib/product-loop-report.mjs'
import { adoptEvidence, applySurfaceScan, inspectProductLoopSurfaces } from './lib/product-loop-surface-scan.mjs'
import { runProductLoopCase } from './lib/product-loop-runners.mjs'
import { ensureIsolatedProductSession, flushProductLoopCleanup, reloadCompanionAfterRelay } from './lib/product-loop-session.mjs'
import { keepExclusiveMilkSUWindow } from './lib/product-loop-windows.mjs'

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

默认按上手顺序跑产品模块：上手 → 主页 Coding → 看板娘 → 领域工作区 → 桌面执行面 → 账户与更新 → 设置其余项。
独立实例贯穿。开测前清掉其它 MilkSU 窗口，只留测试窗。Key 打进设置密码框，不注入 sidecar。
结束后打印从大模块到小模块的文字报告，并写带截图的正式 HTML 报告。

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
      '开测前和每条用例前清掉其它 MilkSU 窗口，只留这一扇测试窗。GitHub 回调不进日常窗口。',
      'Computer Use 缺权限记失败，不偷偷改走隔离浏览器。隔离浏览器自己测打开、跳转、点击、标签和读标记。',
      'GUI 测完走 DeleteConversation / DeleteArchivedConversation，清掉 product-loop fixture。',
      '禁止 desktop:start:beta / MilkSU Beta。',
    ],
    suites: [],
    modules: [],
    humanReview: [],
    eventsNote: 'no Provider keys',
    companionModelSource: '',
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
  if (options.gui) await resetProductLoopReportDir()
  const localEnv = await applyProductLoopLocalEnv(process.env)
  receipt.localEnv = describeProductLoopLocalEnv({ ...localEnv, env: process.env })
  const requestedCases = options.cases ?? []
  let session = { driver: null, instanceId: '', sourcesReady: false, ok: false }

  async function attachEvidence(id, record) {
    const driver = session.driver
    if (!driver) return record
    try {
      const bundle = await captureProductLoopEvidenceBundle(driver, id, {
        result: record.result,
        expectedMiss: record.expectedMiss === true,
      })
      adoptEvidence(record, bundle)
    } catch {
      record.screenshots = record.screenshots || []
    }
    return record
  }

  async function recordCase(id, outcome) {
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
      source: outcome.source || '',
      skipKind: outcome.skipKind || '',
      steps: outcome.steps,
      screenshots: Array.isArray(outcome.screenshots) ? outcome.screenshots : [],
      anomalies: Array.isArray(outcome.anomalies) ? outcome.anomalies : undefined,
      expectedMiss: outcome.expectedMiss === true,
    }
    if (record.source) receipt.companionModelSource = record.source
    if (!record.screenshots.length) await attachEvidence(id, record)
    else if (session.driver && !record.anomalies) {
      try {
        applySurfaceScan(record, await inspectProductLoopSurfaces(session.driver, {
          caseId: id,
          result: record.result,
          expectedMiss: outcome.expectedMiss === true,
        }), { caseId: id, result: record.result, expectedMiss: outcome.expectedMiss === true })
      } catch {
        // Surface may have torn down after the case.
      }
    }
    receipt.suites.push(record)
    process.stdout.write(`CASE ${id} ${record.result} ${record.detail}\n`)
    await flushProductLoopCleanup()
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
    } else {
      await enablePersonalRelayRoute(session.driver).catch(() => {})
    }
    if (session.sourcesReady) {
      await reloadCompanionAfterRelay(session.driver).catch(() => {})
    }
    return true
  }

  async function runProductCase(id) {
    const item = CASES[id]
    if (item?.needsCredential && !session.sourcesReady) {
      return {
        result: 'FAIL',
        detail: '没有可用的个人中转站，也没有已验证的账户模型；source=none',
        source: 'none',
      }
    }
    return runProductLoopCase(id, session.driver, options)
  }

  try {
    const claim = await keepExclusiveMilkSUWindow({ log: true })
    if (claim.closed) receipt.humanReview.push(claim.detail)
    for (const group of groupCasesByModule(requestedCases)) {
      process.stdout.write(`MODULE ${group.module.id} start ${group.module.title}\n`)
      if (group.module.id === 'first-use') {
        if (session.driver) {
          await session.driver.close().catch(() => {})
          session = { driver: null, instanceId: '', sourcesReady: false, ok: false }
        }
        const outcome = await runFirstUse({
          ...options,
          keepOpen: true,
          onStep: async (id, driver, extra = {}) => captureProductLoopEvidenceBundle(driver, id, extra),
        })
        if (outcome.notes?.length) receipt.humanReview.push(...outcome.notes)
        session = {
          driver: outcome.driver || null,
          instanceId: outcome.instanceId || '',
          sourcesReady: outcome.sourcesReady === true,
          ok: Boolean(outcome.driver),
        }
        const produced = new Set((outcome.steps ?? []).map(step => step.id))
        for (const item of group.cases) {
          const step = (outcome.steps ?? []).find(row => row.id === item.id)
          if (step) {
            await recordCase(item.id, step)
            continue
          }
          await recordCase(item.id, {
            result: 'FAIL',
            detail: produced.size ? '上手没跑到' : (outcome.detail || '上手没跑到'),
          })
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
        await recordCase(item.id, outcome)
      }
    }
  } catch (error) {
    const message = redactProcessText(error instanceof Error ? error.message : error, 400)
    receipt.humanReview.push(message)
    for (const id of requestedCases) {
      if (receipt.suites.some(row => row.id === id)) continue
      await recordCase(id, { result: 'FAIL', detail: message })
    }
  } finally {
    await flushProductLoopCleanup()
    if (session.driver) await session.driver.close()
  }

  receipt.finishedAt = new Date().toISOString()
  receipt.result = finalizeProductLoopResult(receipt.suites, requestedCases, receipt.humanReview)
  const report = printProductLoopReport(receipt)
  receipt.report = {
    modules: report.modules.map(item => ({ id: item.id, title: item.title, result: item.result, total: item.total, passed: item.passed, failed: item.failed, skipped: item.skipped })),
    overall: report.overall,
  }
  const formalPath = await writeFormalProductLoopReport(receipt, report)
  receipt.formalReport = formalPath
  await writeReceipt(receipt)
  console.log(`receipt ${resultPath}`)
  console.log(`formal-report ${formalPath}`)
  process.exitCode = receipt.result === 'PASS' ? 0 : 1
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) {
  await main()
}

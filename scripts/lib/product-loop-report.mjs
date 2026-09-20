/**
 * Hierarchical product-loop report. Prints after the run.
 * Large module → small case → overall view. Never includes Provider keys.
 */

import { CASES, MODULES, MODULE_RUN_ORDER, finalizeProductLoopResult } from './product-loop-catalog.mjs'

function pad(value, width) {
  const text = String(value ?? '')
  return text.length >= width ? text : `${text}${' '.repeat(width - text.length)}`
}

function countBy(rows, result) {
  return rows.filter(item => item.result === result).length
}

export function buildProductLoopReport(receipt = {}) {
  const cases = Array.isArray(receipt.suites) ? receipt.suites : []
  const byId = new Map(cases.map(item => [item.id, item]))
  const modules = []
  for (const moduleId of MODULE_RUN_ORDER) {
    const module = MODULES[moduleId]
    const rows = module.cases
      .map(id => byId.get(id))
      .filter(Boolean)
    if (!rows.length) continue
    const failed = countBy(rows, 'FAIL')
    const skipped = countBy(rows, 'SKIP')
    const passed = countBy(rows, 'PASS')
    modules.push({
      id: module.id,
      title: module.title,
      result: failed ? 'FAIL' : rows.length === skipped ? 'SKIP' : 'PASS',
      passed,
      failed,
      skipped,
      total: rows.length,
      cases: rows.map(item => ({
        id: item.id,
        title: item.title || CASES[item.id]?.title || item.id,
        result: item.result,
        detail: item.detail || '',
      })),
    })
  }
  const overall = {
    result: receipt.result || finalizeProductLoopResult(cases, cases.map(item => item.id), receipt.humanReview),
    modules: modules.length,
    modulePass: countBy(modules, 'PASS'),
    moduleFail: countBy(modules, 'FAIL'),
    moduleSkip: countBy(modules, 'SKIP'),
    cases: cases.length,
    casePass: countBy(cases, 'PASS'),
    caseFail: countBy(cases, 'FAIL'),
    caseSkip: countBy(cases, 'SKIP'),
    mode: receipt.mode || '',
    startedAt: receipt.startedAt || '',
    finishedAt: receipt.finishedAt || '',
  }
  return { modules, overall }
}

export function formatProductLoopReport(receipt = {}, report = buildProductLoopReport(receipt)) {
  const { modules, overall } = report
  const lines = [
    '',
    '================================================================================',
    'MilkSU 产品回归报告',
    `模式 ${overall.mode || '-'}    结果 ${overall.result}    大模块 ${overall.modules}    小模块 ${overall.cases}`,
    '================================================================================',
    '',
  ]
  for (const module of modules) {
    lines.push(`${module.title}  [${module.result}]  ${module.passed}/${module.total}`)
    for (const item of module.cases) {
      const detail = item.detail ? `  ${item.detail}` : ''
      lines.push(`  ${pad(item.result, 6)}  ${pad(item.title, 16)}  ${item.id}${detail}`)
    }
    lines.push('')
  }
  lines.push('整体')
  lines.push(`  大模块  ${overall.modules}  通过 ${overall.modulePass}  失败 ${overall.moduleFail}  跳过 ${overall.moduleSkip}`)
  lines.push(`  小模块  ${overall.cases}  通过 ${overall.casePass}  失败 ${overall.caseFail}  跳过 ${overall.caseSkip}`)
  lines.push(`  结论    ${overall.result}`)
  lines.push('================================================================================')
  lines.push('')
  return lines.join('\n')
}

export function printProductLoopReport(receipt) {
  const report = buildProductLoopReport(receipt)
  process.stdout.write(formatProductLoopReport(receipt, report))
  return report
}

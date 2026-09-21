/**
 * Hierarchical product-loop report. Prints after the run.
 * Large module → small case → overall view. Never includes Provider keys.
 * Also writes a formal HTML report with per-case screenshots.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  isCompanionPetSurface,
  repositoryRoot,
} from './desktop-gui-driver.mjs'
import { CASES, MODULES, MODULE_RUN_ORDER, finalizeProductLoopResult } from './product-loop-catalog.mjs'
import {
  inspectProductLoopSurfaces,
  mergeSurfaceScans,
  scanProductLoopSurfaces,
} from './product-loop-surface-scan.mjs'

export const PRODUCT_LOOP_REPORT_DIR = join(repositoryRoot, 'build', 'test-results', 'product-loop-report')

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
    const failed = countBy(rows, 'FAIL') + countBy(rows, 'BLOCKED')
    const skipped = countBy(rows, 'SKIP')
    const passed = countBy(rows, 'PASS')
    modules.push({
      id: module.id,
      title: module.title,
      result: failed ? 'FAIL' : skipped ? 'SKIP' : 'PASS',
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
    companionModelSource: receipt.companionModelSource || '',
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
  if (overall.companionModelSource) lines.push(`  桌宠来源  ${overall.companionModelSource}`)
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function resetProductLoopReportDir() {
  await rm(join(PRODUCT_LOOP_REPORT_DIR, 'shots'), { recursive: true, force: true })
  await mkdir(join(PRODUCT_LOOP_REPORT_DIR, 'shots'), { recursive: true })
}

export function evidenceSurfacesForCase(id) {
  const module = CASES[id]?.module
  if (module === 'companion') {
    if (/^companion-(settings-|skin-default|skin-import|float$)/.test(id)) return ['main']
    if (/^companion-(hide|dock-park)$/.test(id)) return ['main', 'companion']
    return ['companion']
  }
  return ['main']
}

export function normalizeScreenshot(shot) {
  if (!shot) return null
  if (typeof shot === 'string') return { src: shot, label: '', caption: '' }
  const src = String(shot.src || shot.path || '').trim()
  if (!src) return null
  return {
    src,
    label: String(shot.label || ''),
    caption: String(shot.caption || ''),
  }
}

async function saveEvidenceShot(name, label, shot) {
  const buffer = shot?.buffer
  if (!buffer?.length) return null
  const dir = join(PRODUCT_LOOP_REPORT_DIR, 'shots')
  await mkdir(dir, { recursive: true })
  const file = `${name}.png`
  await writeFile(join(dir, file), buffer)
  return {
    src: `shots/${file}`,
    label,
    caption: String(shot.caption || '').slice(0, 200),
  }
}

export async function captureProductLoopEvidence(driver, id) {
  const bundle = await captureProductLoopEvidenceBundle(driver, id)
  return bundle.screenshots
}

export async function captureProductLoopEvidenceBundle(driver, id, options = {}) {
  const screenshots = []
  const snapshots = []
  const scanOptions = {
    caseId: id,
    result: options.result,
    expectedMiss: options.expectedMiss === true,
  }
  if (!driver || !id) {
    return { screenshots, scan: scanProductLoopSurfaces([], scanOptions) }
  }
  const surfaces = evidenceSurfacesForCase(id)
  if (surfaces.includes('companion')) {
    try {
      const shot = await driver.captureSurfaceEvidence(isCompanionPetSurface)
      const overlay = await saveEvidenceShot(`${id}-companion`, '桌宠', shot)
      if (overlay) screenshots.push(overlay)
      if (shot?.caption) snapshots.push({ surface: 'companion', text: shot.caption, caption: shot.caption })
    } catch {
      // Overlay may be hidden or parked.
    }
  }
  if (surfaces.includes('main')) {
    try {
      const shot = await driver.captureMainEvidence()
      const main = await saveEvidenceShot(id, '主窗口', shot)
      if (main) screenshots.push(main)
      if (shot?.caption) snapshots.push({ surface: 'main', text: shot.caption, caption: shot.caption })
    } catch {
      // Main window may be parked.
    }
  }
  let liveScan
  try {
    liveScan = await inspectProductLoopSurfaces(driver, { ...scanOptions, phase: 'evidence' })
  } catch {
    liveScan = scanProductLoopSurfaces(snapshots, { ...scanOptions, phase: 'evidence' })
  }
  const captionScan = scanProductLoopSurfaces(snapshots, { ...scanOptions, phase: 'caption' })
  const scan = mergeSurfaceScans(liveScan, captionScan)
  if (scan.fail && scan.hits.some(item => item.surface === 'companion') && !screenshots.some(item => item.label === '桌宠')) {
    try {
      const extra = await saveEvidenceShot(
        `${id}-companion-anomaly`,
        '桌宠',
        await driver.captureSurfaceEvidence(isCompanionPetSurface),
      )
      if (extra) screenshots.push(extra)
    } catch {
      // Companion may already be hidden.
    }
  }
  const firstHit = (scan.hits || []).find(item => item.severity === 'leak' || item.severity === 'error')
  if (firstHit) {
    for (const shot of screenshots) {
      if (shot.caption && shot.caption.includes(firstHit.text)) continue
      shot.caption = [shot.caption, scan.summary].filter(Boolean).join(' · ').slice(0, 240)
    }
  }
  return { screenshots, scan }
}

export function formatFormalProductLoopReport(receipt = {}, report = buildProductLoopReport(receipt)) {
  const byId = new Map((receipt.suites || []).map(item => [item.id, item]))
  const { modules, overall } = report
  const blocks = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<title>MilkSU 产品回归正式报告</title>',
    '<style>',
    'body{font:14px/1.5 ui-sans-serif,system-ui,sans-serif;margin:24px;background:#fcfcfc;color:#141414}',
    'h1,h2{font-weight:600} .fail{color:#b42318} .pass{color:#027a48} .skip{color:#6b7280}',
    'section{margin:0 0 28px} article{border:1px solid #e5e5e5;border-radius:8px;padding:12px;margin:12px 0;background:#fff}',
    'img{max-width:100%;border:1px solid #e5e5e5;border-radius:8px;margin:8px 8px 0 0}',
    '</style></head><body>',
    '<h1>MilkSU 产品回归正式报告</h1>',
    `<p>模式 ${escapeHtml(overall.mode)}　结果 <strong class="${String(overall.result).toLowerCase()}">${escapeHtml(overall.result)}</strong>　开始 ${escapeHtml(overall.startedAt)}　结束 ${escapeHtml(overall.finishedAt)}</p>`,
    `<p>大模块 ${overall.modules}（通过 ${overall.modulePass} / 失败 ${overall.moduleFail} / 跳过 ${overall.moduleSkip}）　小模块 ${overall.cases}（通过 ${overall.casePass} / 失败 ${overall.caseFail} / 跳过 ${overall.caseSkip}）${overall.companionModelSource ? `　桌宠来源 ${escapeHtml(overall.companionModelSource)}` : ''}</p>`,
  ]
  for (const module of modules) {
    blocks.push(`<section><h2>${escapeHtml(module.title)} <span class="${String(module.result).toLowerCase()}">[${escapeHtml(module.result)}]</span> ${module.passed}/${module.total}</h2>`)
    for (const item of module.cases) {
      const raw = byId.get(item.id) || {}
      const shots = (Array.isArray(raw.screenshots) ? raw.screenshots : []).map(normalizeScreenshot).filter(Boolean)
      blocks.push('<article>')
      blocks.push(`<h3 class="${String(item.result).toLowerCase()}">${escapeHtml(item.result)}　${escapeHtml(item.title)}　<code>${escapeHtml(item.id)}</code></h3>`)
      if (item.detail) blocks.push(`<p>${escapeHtml(item.detail)}</p>`)
      const anomalies = Array.isArray(raw.anomalies) ? raw.anomalies : []
      if (anomalies.length) {
        blocks.push('<div class="fail"><p>表面异常</p><ul>')
        for (const hit of anomalies) {
          const line = [hit.surface, hit.kind, hit.text].filter(Boolean).join(' · ')
          blocks.push(`<li>${escapeHtml(line)}</li>`)
        }
        blocks.push('</ul></div>')
      }
      if (!shots.length) blocks.push('<p class="skip">这一项没有截到产品窗口。</p>')
      for (const shot of shots) {
        const title = [shot.label, shot.caption].filter(Boolean).join(' · ')
        if (title) blocks.push(`<p>${escapeHtml(title)}</p>`)
        blocks.push(`<img src="${escapeHtml(shot.src)}" alt="${escapeHtml(title || item.id)}">`)
      }
      blocks.push('</article>')
    }
    blocks.push('</section>')
  }
  blocks.push('</body></html>')
  return blocks.join('\n')
}

export async function writeFormalProductLoopReport(receipt, report = buildProductLoopReport(receipt)) {
  await mkdir(PRODUCT_LOOP_REPORT_DIR, { recursive: true })
  const htmlPath = join(PRODUCT_LOOP_REPORT_DIR, 'index.html')
  await writeFile(htmlPath, `${formatFormalProductLoopReport(receipt, report)}\n`)
  return htmlPath
}

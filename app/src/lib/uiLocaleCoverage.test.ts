import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = join(import.meta.dirname, '..')
const chinese = /[\u4e00-\u9fff]/
const skipName = /\.test\.ts$|\.d\.ts$/
const scanRoots = [
  join(sourceRoot, 'components-vue'),
  join(sourceRoot, 'composables'),
  join(sourceRoot, 'lib'),
  join(sourceRoot, 'App.vue'),
  join(sourceRoot, 'codingSkills.ts'),
  join(sourceRoot, 'codingContinuity.ts'),
  join(sourceRoot, 'modelCatalog.ts'),
]

function walk(target: string): string[] {
  const files: string[] = []
  const stat = statSync(target)
  if (stat.isFile()) return skipName.test(target) ? [] : [target]
  for (const entry of readdirSync(target)) {
    if (entry === 'previews') continue
    const path = join(target, entry)
    const next = statSync(path)
    if (next.isDirectory()) files.push(...walk(path))
    else if (/\.(vue|ts)$/.test(entry) && !skipName.test(entry)) files.push(path)
  }
  return files
}

function skipQuoted(source: string, start: number, quote: string): number {
  let index = start + 1
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === quote) return index + 1
    index += 1
  }
  return source.length
}

function stripTCalls(source: string): string {
  let output = ''
  let index = 0
  while (index < source.length) {
    const canStart = index === 0 || /[^A-Za-z0-9_$]/.test(source[index - 1] ?? '')
    if (canStart && source.startsWith('t(', index)) {
      let depth = 1
      index += 2
      while (index < source.length && depth > 0) {
        const character = source[index]
        if (character === "'" || character === '"' || character === '`') {
          index = skipQuoted(source, index, character)
          continue
        }
        if (character === '(') depth += 1
        else if (character === ')') depth -= 1
        index += 1
      }
      output += ' '
      continue
    }
    output += source[index]
    index += 1
  }
  return output
}

function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function isStoredOrAgentChinese(line: string): boolean {
  const text = line.trim()
  if (/\bkeywords\s*:/.test(text)) return true
  if (/\bprompt\s*:/.test(text)) return true
  if (/用户当前请求：|本轮通过 Playwright|本轮使用已锁定/.test(text)) return true
  if (/===\s*['`]/.test(text) || /!==\s*['`]/.test(text)) return true
  if (/\bvalue:\s*['`]/.test(text) || /model-value=/.test(text)) return true
  if (/\bstatus:\s*['`]/.test(text)) return true
  if (/\bcacheState:\s*['`]/.test(text)) return true
  if (/\.statuses\[/.test(text)) return true
  if (/\/[^/\n]*[\u4e00-\u9fff][^/\n]*\//.test(text)) return true
  if (/\.test\(/.test(text) || /\.match\(/.test(text)) return true
  if (/请执行：|参考材料：|情报源|已导入 Feed|当前 CVE 来源|用户确认|研究任务：|练习环境：|用户笔记：|请执行/.test(text)) return true
  if (/^[-`]*受影响范围：|^[-`]*状态：|^[-`]*利用成熟度：|^[-`]*摘要：/.test(text)) return true
  if (/先阅读并总结公告|按用户当前任务|如果存在已确认练习环境|把结论分成|不要把情报命中/.test(text)) return true
  if (/先总结公告与补丁/.test(text)) return true
  if (/^[:?]?\s*'[\u4e00-\u9fff]{2,8}'/.test(text)) return true
  if (/\?\s*'[\u4e00-\u9fff]{2,8}'/.test(text)) return true
  if (/:\s*'[\u4e00-\u9fff]{2,8}'/.test(text)) return true
  return false
}

function leftoverChinese(path: string): string[] {
  const relativePath = relative(sourceRoot, path)
  if (
    relativePath.endsWith('vulnerabilityFeedImport.ts')
    || relativePath.endsWith('useVulnerabilityDashboard.ts')
    || relativePath.endsWith('codingProjectMemory.ts')
    || relativePath.endsWith('codingConversationGroups.ts')
    || relativePath.endsWith('workspaceSessionRouting.ts')
  ) {
    return []
  }
  const source = readFileSync(path, 'utf8')
  const cleaned = stripComments(stripTCalls(source))
  return cleaned
    .split('\n')
    .map((line, index) => ({ line, index }))
    .filter(item => chinese.test(item.line) && !isStoredOrAgentChinese(item.line))
    .map(item => `${relativePath}:${item.index + 1}: ${item.line.trim()}`)
}

describe('ui locale coverage', () => {
  it('keeps user-visible Chinese paired with English through t()', () => {
    const leftovers = scanRoots.flatMap(walk).flatMap(leftoverChinese)
    expect(leftovers, leftovers.slice(0, 40).join('\n')).toEqual([])
  })
})

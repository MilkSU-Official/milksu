// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// `useConversations()` 是**工厂**：每调一次就新建一份 store + runtime。
// 组件里调它，等于拿到**另一份空数据** ✗ —— 今天被这个坑咬了三次（侧栏那一行不显示 ✓、
// 对话内窄带不出现 ✓、… ）共性是：界面看起来“什么都没发生”，而代码读起来是对的 ✗。
//
// 规矩：**只有持有 runtime 的那一层**能调它（App ✓ / ChatPage ✓），其它组件一律**走 props** ✓。
// 这条测试把"新增一个偷偷调工厂的组件"钉死 ✗→✓（并把现有两处冻在名单里 ✓）。
const ALLOWED = new Set([
  'src/App.tsx',
  'src/components/ChatPage.tsx',
])

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..', '..')

function sourceFiles(): string[] {
  const files: string[] = [join(appRoot, 'src', 'App.tsx')]
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) files.push(path)
    }
  }
  walk(join(appRoot, 'src', 'components'))
  return files
}

/** 去掉注释：只认真正的调用（我先前把一条警示注释误判成调用 ✗）。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('components never reach for a second conversation store', () => {
  it('only the runtime holders call useConversations()', () => {
    const offenders: string[] = []
    for (const file of sourceFiles()) {
      const relative = file.slice(appRoot.length + 1)
      if (ALLOWED.has(relative)) continue
      const code = stripComments(readFileSync(file, 'utf8'))
      if (/\buseConversations\s*\(/.test(code)) offenders.push(relative)
    }
    expect(offenders).toEqual([])
  })

  it('the frozen allow-list still matches reality', () => {
    // 名单里的文件必须**真的**在调工厂 ✓ —— 否则名单会变成“过期的借口” ✗。
    for (const relative of ALLOWED) {
      const code = stripComments(readFileSync(join(appRoot, relative), 'utf8'))
      expect({ file: relative, calls: /\buseConversations\s*\(/.test(code) }).toEqual({ file: relative, calls: true })
    }
  })
})

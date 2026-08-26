// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders common Agent response structures', () => {
    const html = renderMarkdown(`
## 证据链

1. **Base64 解码**
2. 使用 \`ctf_decode\`

| 状态 | 结果 |
| --- | --- |
| Judge | Accepted |

\`\`\`text
safe output
\`\`\`
`)
    expect(html).toContain('<h2>证据链</h2>')
    expect(html).toContain('<strong>Base64 解码</strong>')
    expect(html).toContain('<ol>')
    expect(html).toContain('<table>')
    expect(html).toContain('class="agent-code"')
    expect(html).toContain('safe output')
    expect(html).toContain('agent-code__n')
  })

  it('removes executable HTML and unsafe links', () => {
    const html = renderMarkdown(`
<script>window.pwned = true</script>

[unsafe](javascript:alert(1))

<img src=x onerror=alert(1)>
`)
    const container = document.createElement('div')
    container.innerHTML = html
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[onerror]')).toBeNull()
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(container.textContent).toContain('window.pwned = true')
  })

  it('opens normal links in an isolated browser context and never embeds images', () => {
    const html = renderMarkdown(`
[MilkSU](https://github.com/MilkSU-Official/milksu)

![remote](https://example.com/tracker.png)
`)
    expect(html).toContain('href="https://github.com/MilkSU-Official/milksu"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('[图片：remote]')
    expect(html).not.toContain('<img')
  })

  it('highlights fenced TypeScript and numbers each line', () => {
    const html = renderMarkdown('```ts\nconst flavor = "pistachio"\n```')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('hljs-string')
    expect(html).toContain('agent-code__n')
    expect(html).toContain('>1<')
  })
})

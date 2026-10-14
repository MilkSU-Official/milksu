export type CodingBrowserTab = {
  id: string
  title: string
  url: string
  active: boolean
}

export function matchCodingTab(
  tabs: CodingBrowserTab[],
  tabId: string,
  query: string,
): CodingBrowserTab {
  const id = String(tabId ?? '').trim()
  const needle = String(query ?? '').trim()
  if (id) {
    const matched = tabs.find((tab) => tab.id === id)
    if (!matched) throw new Error('没有这个浏览器标签')
    return matched
  }
  if (!needle) throw new Error('请提供 tabId，或先列出标签再选一个')
  const lowered = needle.toLowerCase()
  const matches = tabs.filter((tab) => {
    return tab.title.toLowerCase().includes(lowered) || tab.url.toLowerCase().includes(lowered)
  })
  if (matches.length === 1) return matches[0]!
  if (matches.length === 0) {
    throw new Error(`没有标题或地址匹配 "${query}" 的标签，请先 list_browser_tabs`)
  }
  throw new Error(`有 ${matches.length} 个标签匹配 "${query}"，请改用准确的 tabId`)
}

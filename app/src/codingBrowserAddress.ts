const explicitSchemePattern = /^[a-z][a-z0-9+.-]*:/i
const localHostPattern = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/i

export function normalizeCodingBrowserAddress(raw: string): string {
  const value = raw.trim()
  if (!value) throw new Error('请输入网址或搜索内容。')

  let candidate: string
  if (/^https?:\/\//i.test(value)) {
    candidate = value
  } else if (localHostPattern.test(value)) {
    candidate = `http://${value}`
  } else if (explicitSchemePattern.test(value)) {
    throw new Error('浏览器只支持 http 或 https 地址。')
  } else if (!/\s/u.test(value) && value.includes('.')) {
    candidate = `https://${value}`
  } else {
    candidate = `https://duckduckgo.com/?q=${encodeURIComponent(value)}`
  }

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error('无法识别这个网址或搜索内容。')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('浏览器只支持 http 或 https 地址。')
  }
  return parsed.toString()
}

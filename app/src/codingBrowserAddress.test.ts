import { describe, expect, it } from 'vitest'

import { normalizeCodingBrowserAddress } from './codingBrowserAddress'

describe('normalizeCodingBrowserAddress', () => {
  it('opens a bare domain as HTTPS', () => {
    expect(normalizeCodingBrowserAddress('google.com')).toBe('https://google.com/')
    expect(normalizeCodingBrowserAddress('example.com/docs')).toBe('https://example.com/docs')
  })

  it('keeps explicit web URLs and uses HTTP for local development hosts', () => {
    expect(normalizeCodingBrowserAddress('https://www.google.com/search?q=MilkSU'))
      .toBe('https://www.google.com/search?q=MilkSU')
    expect(normalizeCodingBrowserAddress('localhost:3000')).toBe('http://localhost:3000/')
    expect(normalizeCodingBrowserAddress('127.0.0.1:4173')).toBe('http://127.0.0.1:4173/')
  })

  it('turns ordinary text into a privacy-preserving web search', () => {
    expect(normalizeCodingBrowserAddress('MilkSU 浏览器'))
      .toBe('https://duckduckgo.com/?q=MilkSU%20%E6%B5%8F%E8%A7%88%E5%99%A8')
  })

  it('rejects non-web schemes and empty input', () => {
    expect(() => normalizeCodingBrowserAddress('javascript:alert(1)')).toThrow('只支持 http 或 https')
    expect(() => normalizeCodingBrowserAddress('   ')).toThrow('请输入网址或搜索内容')
  })
})

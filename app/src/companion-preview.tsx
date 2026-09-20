import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans-sc'
import './index.css'

import { createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CompanionPetWindow from '@/components/CompanionPetWindow'
import { applyThemeMode, type ThemeMode } from '@/lib/themeMode'
import type { CompanionTranscriptEntry } from '@/types'

/** Temporary design-review harness. Not a product surface; delete after review. */

const now = Date.now()
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString()

const entries: CompanionTranscriptEntry[] = [
  { id: '1', type: 'thinking_level_change', timestamp: at(9), role: 'system', text: 'thinking_level_change' },
  { id: '2', type: 'model_change', timestamp: at(9), role: 'system', text: 'model_change' },
  { id: '3', type: 'model_change', timestamp: at(9), role: 'system', text: 'model_change' },
  { id: '4', type: 'message', timestamp: at(8), role: 'assistant', text: '登录失败的报错是会话令牌过期之后没有重新拉取。' },
  { id: '5', type: 'message', timestamp: at(8), role: 'assistant', text: '已经改好了。' },
  { id: '6', type: 'message', timestamp: at(8), role: 'assistant', text: '你再试试，还不行就把控制台那一段贴给我。' },
  { id: '7', type: 'message', timestamp: at(7), role: 'user', text: 'az' },
  { id: '8', type: 'message', timestamp: at(7), role: 'user', text: '摸摸' },
  { id: '9', type: 'message', timestamp: at(3), role: 'assistant', text: '没事，这种会话过期的坑我也踩过。' },
  { id: '10', type: 'message', timestamp: at(1), role: 'user', text: '那明天继续跑回归。' },
]

function fixture(method: string): unknown {
  switch (method) {
    case 'EnsureCompanion':
      return { ready: true, provider: 'TokenFlux', model: 'deepseek-flash' }
    case 'ListCompanionTranscript':
      return { entries, hasMore: false }
    case 'GetCompanionBoard':
      return { sessions: [], todos: [] }
    case 'GetCompanionMemory':
      return { pending: [], approved: [] }
    case 'ListCompanionArchives':
      return []
    case 'GetCompanionShellStatus':
      return {
        floating: true,
        hidden: false,
        wayland: false,
        tray: true,
        chatOpen: true,
        overlay: { petVisible: false, chatOpen: true, mainVisible: false, chatSide: 'left' },
      }
    case 'GetSettings':
      return { companion_skin_id: 'default' }
    case 'GetCompanionSkin':
      return {
        id: 'default',
        source: 'factory',
        factory: true,
        name: { zh: 'Milk', en: 'Milk' },
        overlay: { think: 'spin', decide: 'bang', complete: 'bang' },
        mark: { cx: 0.5, cy: 0.24, size: 0.26 },
        frames: {},
      }
    default:
      return undefined
  }
}

window.milksu = {
  hostPlatform: 'darwin',
  invoke: (method: string) => Promise.resolve(fixture(method)),
  onEvent: () => () => undefined,
}

const mode = new URLSearchParams(window.location.search).get('theme')
applyThemeMode(mode === 'light' || mode === 'dark' ? (mode as ThemeMode) : 'system')

const root = document.getElementById('app')
if (!root) throw new Error('MilkSU renderer root #app is missing')
createRoot(root).render(
  createElement(
    StrictMode,
    null,
    createElement(
      'div',
      { style: { width: 320, height: 620, overflow: 'hidden' } },
      createElement(CompanionPetWindow),
    ),
  ),
)

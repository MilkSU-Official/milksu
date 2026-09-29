// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ContextSidebar from '@/components/ContextSidebar'
import { FACTORY_PROJECT_FOLD_LIMIT, applyProjectFoldLimit } from '@/lib/projectFoldLimit'
import type { Conversation } from '@/types'

afterEach(() => {
  cleanup()
  applyProjectFoldLimit(FACTORY_PROJECT_FOLD_LIMIT)
})

function projectConversation(index: number): Conversation {
  return {
    id: `conv-${index}`,
    title: `会话 ${index}`,
    createdAt: 1_700_000_000_000 + index * 1000,
    workspacePath: '/home/user/code/alpha',
    messages: [],
  } as Conversation
}

function renderSidebar(conversations: Conversation[]) {
  return render(
    <ContextSidebar
      activeSection="chat"
      activeConversationId={null}
      conversations={conversations}
      ctfSection="catalog"
      accountStatus={{ configured: false, authenticated: false, state: 'unconfigured' }}
      themeMode="system"
    />,
  )
}

describe('ContextSidebar 项目文件夹折叠', () => {
  it('默认阈值 5：项目里 5 条会话全显示，不出展开行', () => {
    renderSidebar(Array.from({ length: 5 }, (_, index) => projectConversation(index)))
    expect(screen.queryByText('会话 4')).not.toBeNull()
    expect(screen.queryByText('展开')).toBeNull()
  })

  it('默认阈值 5：项目里 7 条会话先显示 5 条，点展开后全显示并可收起', () => {
    renderSidebar(Array.from({ length: 7 }, (_, index) => projectConversation(index)))
    // 分组按活跃时间倒序：最新的是「会话 6」，前 5 条可见，其余先被收起。
    expect(screen.queryByText('会话 6')).not.toBeNull()
    expect(screen.queryByText('会话 2')).not.toBeNull()
    expect(screen.queryByText('会话 1')).toBeNull()

    fireEvent.click(screen.getByText('展开'))
    expect(screen.queryByText('会话 0')).not.toBeNull()
    expect(screen.queryByText('展开')).toBeNull()

    fireEvent.click(screen.getByText('收起显示'))
    expect(screen.queryByText('会话 1')).toBeNull()
    expect(screen.queryByText('展开')).not.toBeNull()
  })

  it('设置改成 3 后只先显示 3 条', () => {
    applyProjectFoldLimit(3)
    renderSidebar(Array.from({ length: 7 }, (_, index) => projectConversation(index)))
    expect(screen.queryByText('会话 6')).not.toBeNull()
    expect(screen.queryByText('会话 4')).not.toBeNull()
    expect(screen.queryByText('会话 3')).toBeNull()
    expect(screen.queryByText('展开')).not.toBeNull()
  })

  it('钉选组不参与折叠，7 条钉选会话全显示', () => {
    const pinned = Array.from({ length: 7 }, (_, index) => ({
      ...projectConversation(index),
      pinned: true,
      pinnedOrder: index,
    }))
    renderSidebar(pinned)
    expect(screen.queryByText('会话 0')).not.toBeNull()
    expect(screen.queryByText('展开')).toBeNull()
  })
})

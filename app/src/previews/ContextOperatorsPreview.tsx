import { useEffect } from 'react'
import ChatMessageItem from '@/components/ChatMessageItem'
import ContextUsageMeter from '@/components/ContextUsageMeter'
import { applyThemeMode } from '@/lib/themeMode'
import { useT } from '@/hooks/useUiLocale'
import {
  applySessionContextComposition,
  applySessionContextWindow,
  applySessionUsageRecorded,
  emptySessionTurnSnapshot,
  presentContextUsage,
} from '@/lib/sessionTurnStatus'
import type { Message } from '@/types'

applyThemeMode('dark')

const earlierUser: Message = {
  id: 'u1',
  role: 'user',
  content: '先读入口，把鉴权改成 header 注入。',
  timestamp: Date.now() - 120_000,
  status: 'done',
}

const earlierAssistant: Message = {
  id: 'a1',
  role: 'assistant',
  content: '已经读过入口。下一步会改请求头，不动现有登录页。',
  timestamp: Date.now() - 90_000,
  status: 'done',
}

const lastUser: Message = {
  id: 'u2',
  role: 'user',
  content: '算了，改成 cookie 方案试试。',
  timestamp: Date.now() - 40_000,
  status: 'done',
}

const lastAssistant: Message = {
  id: 'a2',
  role: 'assistant',
  content: '按 cookie 走了一段，登录态对不上。这一段可以丢掉。',
  timestamp: Date.now() - 10_000,
  status: 'done',
}

let usageState = applySessionContextWindow(emptySessionTurnSnapshot(), 200_000)
usageState = applySessionUsageRecorded(usageState, {
  inputTokens: 28_000,
  outputTokens: 2_400,
  cacheReadTokens: 96_000,
  totalTokens: 126_400,
})
usageState = applySessionContextComposition(usageState, {
  estimatedTokens: 164_000,
  contextWindow: 200_000,
  categories: [
    { id: 'system', tokens: 18_000 },
    { id: 'tools', tokens: 22_000 },
    { id: 'conversation', tokens: 124_000 },
  ],
})
const usage = presentContextUsage(usageState)

export default function ContextOperatorsPreview() {
  const t = useT()

  useEffect(() => {
    applyThemeMode('dark')
  }, [])

  return (
    <div className="min-h-screen bg-background px-8 py-8 text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="space-y-1">
          <p className="text-caption text-muted-foreground">{t('Coding · 设计预览', 'Coding · design preview')}</p>
          <h1 className="text-xl font-medium tracking-tight">
            {t('丢掉这段 / 从这里重发 / 接到新会话', 'Drop this stretch / resend from here / hand off to a new session')}
          </h1>
        </header>

        <section
          className="rounded-lg border border-border bg-card px-6 py-5"
          data-agent-conversation
          data-preview="rewind"
        >
          <p className="mb-4 text-caption text-muted-foreground">{t('最后一问 · 丢掉这段', 'Last question · drop this stretch')}</p>
          <div className="agent-thread preview-thread">
            <ChatMessageItem message={earlierUser} />
            <ChatMessageItem message={earlierAssistant} />
            <ChatMessageItem message={lastUser} canRewind />
            <ChatMessageItem message={lastAssistant} />
          </div>
        </section>

        <section
          className="rounded-lg border border-border bg-card px-6 py-5"
          data-agent-conversation
          data-preview="edit"
        >
          <p className="mb-4 text-caption text-muted-foreground">{t('更早的一问 · 编辑并从这里重发', 'Earlier question · edit and resend from here')}</p>
          <div className="agent-thread preview-thread">
            <ChatMessageItem message={earlierUser} />
          </div>
        </section>

        <section
          className="rounded-lg border border-border bg-card px-6 py-5"
          data-preview="handoff"
        >
          <p className="mb-4 text-caption text-muted-foreground">{t('用量环 · 整理上下文 / 接到新会话', 'Usage ring · compact context / hand off to a new session')}</p>
          <div className="flex items-center justify-end">
            {usage ? (
              <ContextUsageMeter
                usage={usage}
                size="md"
                defaultOpen
              />
            ) : null}
          </div>
        </section>
      </div>

      <style>{`
        .preview-thread .agent-turn-actions {
          opacity: 1;
        }
      `}</style>
    </div>
  )
}

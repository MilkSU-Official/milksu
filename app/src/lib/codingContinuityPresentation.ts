import { t } from '@/lib/uiLocale'

export interface CodingContinuityPresentationInput {
  sessionReady: boolean
  resumed: boolean
  compacting: boolean
  compactedAt?: number
  running: boolean
}

export interface CodingContinuityPresentation {
  badges: string[]
  title: string
  compactDisabled: boolean
  compactTitle: string
  compactLabel: string
}

export function codingContinuityPresentation(
  input: CodingContinuityPresentationInput,
): CodingContinuityPresentation {
  const badges: string[] = []
  if (input.compacting) {
    badges.push(t('整理中', 'Compacting'))
  } else {
    if (!input.sessionReady) badges.push(t('待连接', 'Waiting to connect'))
    else if (input.resumed) badges.push(t('从持久会话恢复', 'Restored from last session'))
    else if (!input.compactedAt) badges.push(t('新会话', 'New session'))
    if (input.sessionReady && input.compactedAt) {
      const time = new Date(input.compactedAt).toLocaleTimeString()
      badges.push(t(`已整理 ${time}`, `Compacted ${time}`))
    }
  }

  const title = input.compacting
    ? t('正在整理上下文', 'Compacting context')
    : !input.sessionReady
        ? t('发送消息后再整理上下文', 'Send a message before compacting context')
        : input.resumed
          ? t('已从上次会话恢复', 'Restored from the previous session')
          : t('新会话', 'New session')

  const compactTitle = input.compacting
    ? t('正在整理上下文', 'Compacting context')
    : !input.sessionReady
      ? t('发送消息后再整理上下文', 'Send a message before compacting context')
      : input.running
        ? t('将停止当前回合并整理上下文', 'This will stop the current turn and compact context')
        : t('整理当前会话上下文', 'Compact current session context')

  return {
    badges,
    title,
    compactDisabled: input.compacting,
    compactTitle,
    compactLabel: input.compacting ? t('整理中…', 'Compacting…') : t('整理上下文', 'Compact context'),
  }
}

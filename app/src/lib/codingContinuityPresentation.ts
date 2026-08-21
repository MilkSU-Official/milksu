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
    badges.push('整理中')
  } else {
    if (!input.sessionReady) badges.push('待连接')
    else if (input.resumed) badges.push('从持久会话恢复')
    else if (!input.compactedAt) badges.push('新会话')
    if (input.sessionReady && input.compactedAt) {
      badges.push(`已整理 ${new Date(input.compactedAt).toLocaleTimeString()}`)
    }
  }

  const title = input.compacting
    ? '正在整理上下文'
    : !input.sessionReady
        ? '发送消息后再整理上下文'
        : input.resumed
          ? '已从上次会话恢复'
          : '新会话'

  const compactTitle = input.compacting
    ? '正在整理上下文'
    : !input.sessionReady
      ? '发送消息后再整理上下文'
      : input.running
        ? '将停止当前回合并整理上下文'
        : '整理当前会话上下文'

  return {
    badges,
    title,
    compactDisabled: input.compacting,
    compactTitle,
    compactLabel: input.compacting ? '整理中…' : '整理上下文',
  }
}

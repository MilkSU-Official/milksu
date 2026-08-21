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
    ? '正在把当前会话上下文压缩为结构化摘要；完成后继续对话即可'
    : !input.sessionReady
        ? '当前任务尚未连接 Pi 会话；发送消息后才能整理上下文'
        : input.resumed
          ? '本任务从持久化的 Pi 会话恢复，历史与已整理摘要仍在会话文件中'
          : '本任务是新会话；长任务可手动整理上下文以控制成本'

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

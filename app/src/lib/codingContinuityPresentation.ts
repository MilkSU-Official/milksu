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
    if (input.compactedAt) {
      badges.push(`已整理 ${new Date(input.compactedAt).toLocaleTimeString()}`)
    }
  }

  const title = input.compacting
    ? '正在把当前会话上下文压缩为结构化摘要；完成后继续对话即可'
    : input.resumed
      ? '本任务从持久化的 Pi 会话恢复，历史与已整理摘要仍在会话文件中'
      : !input.sessionReady
        ? '当前任务尚未连接 Pi 会话；发送消息后才能整理上下文'
        : '本任务是新会话；长任务可手动整理上下文以控制成本'

  const compactTitle = input.compacting
    ? '正在整理上下文'
    : !input.sessionReady
      ? '发送消息并连接 Pi 会话后才能整理上下文'
      : input.running
        ? 'Agent 正在执行回合，请等待当前回合结束再整理上下文'
        : '手动触发 Pi 原生上下文压缩；整理中请等待，运行中不可用'

  return {
    badges,
    title,
    compactDisabled: !input.sessionReady || input.running || input.compacting,
    compactTitle,
    compactLabel: input.compacting ? '整理中…' : '整理上下文',
  }
}

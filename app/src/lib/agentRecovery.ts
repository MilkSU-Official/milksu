import type { Message } from '@/types'

const noActivityFailure = /(?:模型长时间没有产生文本或工具进展|produced no model or tool activity)/i
const networkFailure = /(?:模型或 Agent 网络连接失败|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|network is unreachable|connection refused|fetch failed|dial tcp|context deadline exceeded|i\/o timeout|TLS handshake timeout)/i
const runtimeStoppedFailure = /(?:Agent 已停止|Agent 通信异常|Agent 遇到本地运行时异常|本地 Agent 权限组件启动失败|sidecar exited|engine stopped|engine\.stopped|engine\.protocol_error|protocol error|Agent 进程已停止)/i
const interruptionFailure = /(?:用户已中断|用户取消|已取消|已中断|abort(?:ed)?|cancel(?:led|ed)|interrupted|operation was canceled|context canceled)/i
const contextWindowFailure = /(?:上下文窗口|上下文过长|上下文长度|context window|context length|maximum context|token limit|too many tokens|tokens exceeded|context_length_exceeded)/i

export function recoverableAgentFailureId(
  messages: Message[],
  running: boolean,
) {
  if (running) return ''
  const latest = [...messages].reverse().find(message => message.role !== 'tool')
  if (!latest || latest.role !== 'assistant') return ''
  return noActivityFailure.test(latest.content)
    || networkFailure.test(latest.content)
    || runtimeStoppedFailure.test(latest.content)
    || interruptionFailure.test(latest.content)
    || contextWindowFailure.test(latest.content)
    ? latest.id
    : ''
}

export function agentRecoveryPrompt(ctfSession: boolean) {
  if (ctfSession) {
    return [
      '从刚才的断点继续。',
      '先读取持久化的 notes.md、evidence/run.json、candidate-flags.txt 和最近一次已完成的工具结果；不要重复已经完成的步骤。',
      '不要复用重启前的审批状态；需要扩大权限、Endpoint、应用窗口或外部发布时重新请求一次有意义确认。',
      '选择一个最小、可验证且不同于无进展调用的下一步，尽快把新事实写回 notes.md。',
    ].join(' ')
  }
  return [
    '从刚才的断点继续。',
    '先核对当前工作区、已有改动和最近一次已完成的工具结果；不要重复已经完成的步骤。',
    '不要复用重启前的审批状态；需要扩大权限、应用窗口或外部发布时重新请求一次有意义确认。',
    '如果上次因为超时、取消或上下文过长停止，先压缩/概括已完成事实，再选择一个最小、可验证且不同于无进展调用的下一步继续推进。',
  ].join(' ')
}

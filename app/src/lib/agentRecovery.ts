import type { Message } from '@/types'
import { t } from '@/lib/uiLocale'

const networkFailure = new RegExp(
  `(?:${t('模型或 Agent 网络连接失败', 'Model or Agent network connection failed')}|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|network is unreachable|connection refused|\\bconnection error\\b|fetch failed|dial tcp|context deadline exceeded|i\\/o timeout|TLS handshake timeout)`,
  'i',
)
const runtimeStoppedFailure = new RegExp(
  `(?:${t('Agent 已停止', 'Agent stopped')}|${t('Agent 通信异常', 'Agent communication error')}|${t('Agent 遇到本地运行时异常', 'Agent hit a local runtime error')}|${t('本地 Agent 运行异常', 'The local Agent hit a runtime error')}|${t('本地 Agent 权限组件启动失败', 'The local Agent permission component failed to start')}|sidecar exited|engine stopped|engine\\.stopped|engine\\.protocol_error|protocol error|${t('Agent 进程已停止', 'The Agent process stopped')})`,
  'i',
)
const interruptionFailure = new RegExp(
  `(?:${t('用户已中断', 'Interrupted by the user')}|${t('用户取消', 'Cancelled by the user')}|${t('已取消', 'Cancelled')}|${t('已中断', 'Interrupted')}|abort(?:ed)?|cancel(?:led|ed)|interrupted|operation was canceled|context canceled)`,
  'i',
)
const contextWindowFailure = new RegExp(
  `(?:${t('上下文过长', 'Context is too long')}|${t('上下文已满', 'Context is full')}|${t('自动整理上下文失败', 'Automatic context compaction failed')}|${t('正在自动整理', 'Compacting automatically')}|context window|context length|maximum context|token limit|too many tokens|tokens exceeded|context_length_exceeded|overflow recovery failed)`,
  'i',
)

export function recoverableAgentFailureId(
  messages: Message[],
  running: boolean,
) {
  if (running) return ''
  const latest = [...messages].reverse().find(message => message.role !== 'tool')
  if (!latest || latest.role !== 'assistant') return ''
  return networkFailure.test(latest.content)
    || runtimeStoppedFailure.test(latest.content)
    || interruptionFailure.test(latest.content)
    || contextWindowFailure.test(latest.content)
    ? latest.id
    : ''
}

export function agentRecoveryPrompt(ctfSession: boolean) {
  if (ctfSession) {
    return [
      t('从刚才的断点继续。', 'Continue from the last breakpoint.'),
      t(
        '先读取持久化的 notes.md、evidence/run.json、candidate-flags.txt 和最近一次已完成的工具结果；不要重复已经完成的步骤。',
        'First read the persisted notes.md, evidence/run.json, candidate-flags.txt, and the latest completed tool result; do not repeat finished steps.',
      ),
      t(
        '不要复用重启前的审批状态；需要扩大权限、Endpoint、应用窗口或外部发布时重新请求一次有意义确认。',
        'Do not reuse approval state from before the restart; request a meaningful confirmation again before expanding permissions, an endpoint, an app window, or an external publish.',
      ),
      t(
        '选择一个最小、可验证的下一步，尽快把新事实写回 notes.md。',
        'Pick a small, verifiable next step and write new facts back to notes.md promptly.',
      ),
    ].join(' ')
  }
  return [
    t('从刚才的断点继续。', 'Continue from the last breakpoint.'),
    t(
      '先核对当前工作区、已有改动和最近一次已完成的工具结果；不要重复已经完成的步骤。',
      'First check the current workspace, existing changes, and the latest completed tool result; do not repeat finished steps.',
    ),
    t(
      '不要复用重启前的审批状态；需要扩大权限、应用窗口或外部发布时重新请求一次有意义确认。',
      'Do not reuse approval state from before the restart; request a meaningful confirmation again before expanding permissions, an app window, or an external publish.',
    ),
    t(
      '如果上次因网络超时、取消或上下文整理后停止，先核对已完成事实，再选一个最小可验证的下一步继续。',
      'If the last run stopped after a network timeout, cancel, or context compaction, first confirm completed facts, then continue with a small verifiable next step.',
    ),
  ].join(' ')
}

// R4 桌面可见性：引擎韧性批次（fix/engine-resilience R1a/R1b）五个新事件的纯投影与文案。
//
// 事件流：sidecar emit（model_retry/model_stall/turn_active/harness_recovery/message_queued）
// → Go normalizeBridgeEvent（model.retry/model.stall/turn.active/session.recovery/
// session.message_queued，载荷见 internal/engine/supervisor.go 的五个新 case）
// → 渲染器 useConversations 的 engine-event handler → 本模块投影成可渲染状态。
//
// 本模块只做纯函数：payload → 状态对象、状态对象 → 读者语言文案。副作用（store 写入、
// 横幅挂载）在 composable 与 ChatPage。事件形状的原始证据是 fix/engine-resilience 分支
// harness-events.js（model_retry/turn_active）与 harness-bridge-session.js
//（model_stall/harness_recovery/message_queued）的 emit 现场。

import { t } from '@/lib/uiLocale'

/** model.retry start：一次 durable 重试排程（「网络波动，重试中 x/5」）。end 事件只把
 *  inFlight 翻 true（下一次尝试开跑、倒计时熄掉）；横幅本身挂到回合出结果才收
 *（useConversations 的 finishRun / assistant.completed，见那边的注释）。 */
export interface EngineRetryNotice {
  attempt: number
  maxRetries: number
  /** 引擎自带的读者语言提示（message/messageEnglish 对）。 */
  notice: string
  noticeEnglish: string
  /** 上一次尝试的失败原因（start 载荷的 errorMessage），展示为悬停细节。 */
  errorMessage: string
  /** 下一次尝试的时刻（epoch ms；start 载荷的 retryAt）。phase:end 后清零（不再倒计时）。 */
  retryAt: number
  at: number
  /** phase:end 已到：退避走完、下一次尝试开跑 ⇒ 横幅保留但不显示秒数（「正在重试…」）。 */
  inFlight: boolean
}

/** session.recovery：崩溃后重开进程附着、上一回合仍在飞行（「从断点恢复中」）。 */
export interface EngineRecoveryNotice {
  notice: string
  noticeEnglish: string
  at: number
}

/** session.message_queued：用户消息排队（等当前回合结束）。 */
export interface EngineQueuedNotice {
  position: number
  total: number
  /** 排队消息的文本（事件 text 字段）；对照 queue_update 的 followUp 数组判断是否已被消费。 */
  text: string
  submissionId: string
  notice: string
  noticeEnglish: string
  at: number
}

/** 停滞告警记录：turn.stall_warning（预算告警）与 model.stall（连接静默）共用这一张脸。 */
export interface EngineStallWarning {
  at: number
  stage: string
  budgetMs: number
  payloadBytes: number
  /** model.stall 自带的双语提示（「连接无响应 x 秒」）；预算告警没有这个字段。 */
  notice?: string
  noticeEnglish?: string
  stalledSeconds?: number
  hardKillSeconds?: number
}

function noticePair(payload: Record<string, unknown>) {
  const notice = String(payload.notice ?? '').trim()
  const noticeEnglish = String(payload.noticeEnglish ?? '').trim()
  return { notice, noticeEnglish }
}

/**
 * model.retry 事件 → 重试横幅状态。phase=start 建状态（inFlight=false，带 retryAt 倒计时）；
 * phase=end（或载荷缺计数）返回 null——end 的语义是「退避走完、下一次尝试开跑」，横幅
 * **不收**（挂到回合出结果），只由调用方把既有条目翻成 inFlight=true。引擎没给 message 时
 * 按 attempt/maxRetries 现拼一条。
 */
export function projectModelRetryEvent(payload: Record<string, unknown>): EngineRetryNotice | null {
  const phase = String(payload.phase ?? 'start').trim()
  if (phase !== 'start') return null
  const attempt = Math.max(1, Math.floor(Number(payload.attempt) || 1))
  const maxRetries = Math.max(1, Math.floor(Number(payload.maxRetries) || 1))
  const { notice, noticeEnglish } = noticePair(payload)
  return {
    attempt,
    maxRetries,
    notice,
    noticeEnglish,
    errorMessage: String(payload.errorMessage ?? '').trim(),
    retryAt: Number(payload.retryAt) || 0,
    at: Date.now(),
    inFlight: false,
  }
}

/**
 * 重试横幅文案：优先引擎自带提示，缺省按计数现拼（显示时经 t() 配对，跟 locale 走）。
 * 退避期内（phase:start、retryAt 在未来）明说「x 秒后重试」（x 向下取整）——β.192 真机
 * 验收里裸数字「2.0s」被读者当成「重试间隔只有两秒」，带单位的句子读不出这种歧义。
 * 倒计时走完（phase:end 翻 inFlight，或 retryAt 已过/不足 1 秒）⇒「正在重试…」，不显示秒数。
 */
export function modelRetryLabel(retry: EngineRetryNotice, now = Date.now()): string {
  const base = !retry.notice && !retry.noticeEnglish
    ? t(
      `网络波动，重试中 ${retry.attempt}/${retry.maxRetries}`,
      `Network trouble, retrying ${retry.attempt}/${retry.maxRetries}`,
    )
    : t(retry.notice, retry.noticeEnglish)
  if (!retry.inFlight && retry.retryAt > 0) {
    const secondsLeft = Math.floor((retry.retryAt - now) / 1000)
    if (secondsLeft > 0) {
      return t(
        `${base}，${secondsLeft} 秒后重试`,
        `${base}, retrying in ${secondsLeft}s`,
      )
    }
  }
  return t(`${base}，正在重试…`, `${base}, retrying now…`)
}

/** session.recovery 事件 → 恢复横幅状态；载荷没有可读提示时返回 null（不硬造文案）。 */
export function projectEngineRecoveryEvent(payload: Record<string, unknown>): EngineRecoveryNotice | null {
  const { notice, noticeEnglish } = noticePair(payload)
  if (!notice && !noticeEnglish) return null
  return { notice, noticeEnglish, at: Date.now() }
}

/** 恢复横幅文案：引擎自带的「从断点恢复中」。 */
export function engineRecoveryLabel(recovery: EngineRecoveryNotice): string {
  return t(recovery.notice || '从断点恢复中', recovery.noticeEnglish || 'Resuming from where the engine left off')
}

/**
 * session.message_queued 事件 → 排队提示状态；位次缺省按 1 处理（引擎没给时不撒谎）。
 * 文本（text）可能为空：排队消息的展示与「何时被消费」的判断都以 queue_update 的
 * followUp 数组为准，事件只是触发器。
 */
export function projectMessageQueuedEvent(payload: Record<string, unknown>): EngineQueuedNotice | null {
  const { notice, noticeEnglish } = noticePair(payload)
  const position = Math.max(1, Math.floor(Number(payload.position) || 1))
  const total = Math.max(position, Math.floor(Number(payload.total) || position))
  return {
    position,
    total,
    text: String(payload.text ?? '').trim(),
    submissionId: String(payload.submissionId ?? '').trim(),
    notice,
    noticeEnglish,
    at: Date.now(),
  }
}

/** 排队提示文案：「消息已排队，当前回合结束后处理」+ 位次。 */
export function messageQueuedLabel(queued: EngineQueuedNotice): string {
  return t(
    `消息已排队，当前回合结束后处理（第 ${queued.position} 位，共 ${queued.total} 条）`,
    `Queued for the next turn (position ${queued.position} of ${queued.total})`,
  )
}

/**
 * 排队提示何时收起：回合已结束（running=false）必收；排队文本已从 queue_update 的
 * followUp 数组消失（被回合消费）即收。followUp 传 null 表示还没有任何队列快照
 *（message_queued 常先于首个 queue_update 到达）⇒ 只看 running，不做激进清除。
 */
export function queuedNoticeExpired(queued: EngineQueuedNotice | null | undefined, running: boolean, followUp: readonly string[] | null): boolean {
  if (!queued) return true
  if (!running) return true
  // 没有队列快照 ⇒ 队列内容未知，不猜。
  if (followUp === null) return false
  // 文本对不上（引擎没给 text）时也只看 running。
  if (!queued.text) return false
  return !followUp.includes(queued.text)
}

/**
 * 停滞横幅里的引擎侧说明文案。model.stall（连接静默）自带「连接无响应 x 秒」⇒ 优先
 * 用它，并按 hardKillSeconds 补一句硬阈值的实话（到点引擎自己掐掉重试，不需要读者动手）；
 * turn.stall_warning（预算告警）没有自带提示 ⇒ 沿用既有的预算文案。
 */
export function engineStallWarningLabel(warning: EngineStallWarning | null | undefined, formatElapsed: (ms: number) => string): string {
  if (!warning) return ''
  if (warning.notice || warning.noticeEnglish) {
    const base = t(
      warning.notice || '连接无响应',
      warning.noticeEnglish || 'No response from the model connection',
    )
    const hardKillSeconds = Math.floor(Number(warning.hardKillSeconds) || 0)
    if (hardKillSeconds > 0) {
      return t(
        `${base}；${hardKillSeconds} 秒内仍无响应将自动断开并重试。`,
        `${base}; it will be cut and retried automatically if it stays silent for ${hardKillSeconds}s.`,
      )
    }
    return base
  }
  if (warning.payloadBytes > 0) {
    return t(
      `模型请求已超过等待预算 ${formatElapsed(warning.budgetMs)}（请求约 ${(warning.payloadBytes / (1024 * 1024)).toFixed(1)}MB），引擎仍在等。`,
      `The model request passed its ${formatElapsed(warning.budgetMs)} budget (about ${(warning.payloadBytes / (1024 * 1024)).toFixed(1)}MB) and the engine is still waiting.`,
    )
  }
  return t(
    `模型请求已超过等待预算 ${formatElapsed(warning.budgetMs)}，引擎仍在等。`,
    `The model request passed its ${formatElapsed(warning.budgetMs)} budget and the engine is still waiting.`,
  )
}

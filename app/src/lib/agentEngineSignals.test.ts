// R4 桌面可见性：引擎韧性事件（model.retry / model.stall / turn.active /
// session.recovery / session.message_queued）的纯投影与文案。
import { describe, expect, it } from 'vitest'
import {
  engineRecoveryLabel,
  engineStallWarningLabel,
  messageQueuedLabel,
  modelRetryLabel,
  projectEngineRecoveryEvent,
  projectMessageQueuedEvent,
  projectModelRetryEvent,
  queuedNoticeExpired,
} from '@/lib/agentEngineSignals'

const formatElapsed = (ms: number) => `${Math.round(ms / 1000)}s`

describe('projectModelRetryEvent', () => {
  it('start 事件投影成重试横幅状态，优先用引擎自带双语提示', () => {
    const retry = projectModelRetryEvent({
      phase: 'start',
      attempt: 2,
      maxRetries: 5,
      notice: '网络波动，重试中 2/5',
      noticeEnglish: 'Network trouble, retrying 2/5',
      errorMessage: 'fetch failed',
      retryAt: 1770000000123,
    })
    expect(retry).toMatchObject({
      attempt: 2,
      maxRetries: 5,
      notice: '网络波动，重试中 2/5',
      noticeEnglish: 'Network trouble, retrying 2/5',
      errorMessage: 'fetch failed',
      retryAt: 1770000000123,
      inFlight: false,
    })
    expect(modelRetryLabel(retry!)).toContain('重试中 2/5')
  })

  it('end 事件不投影新状态（保留横幅、熄倒计时由调用方按既有条目处理）', () => {
    expect(projectModelRetryEvent({ phase: 'end', attempt: 2 })).toBeNull()
  })

  it('引擎没给提示时投影原样留空，标签按 attempt/maxRetries 现拼，不撒谎也不空着', () => {
    const retry = projectModelRetryEvent({ phase: 'start', attempt: 3, maxRetries: 5 })
    expect(retry?.notice).toBe('')
    expect(retry?.noticeEnglish).toBe('')
    expect(modelRetryLabel(retry!)).toContain('3/5')
  })

  it('缺省计数按 1 处理，坏值不放大成离谱数字', () => {
    const retry = projectModelRetryEvent({ phase: 'start', attempt: -2, maxRetries: NaN })
    expect(retry?.attempt).toBe(1)
    expect(retry?.maxRetries).toBe(1)
  })
})

describe('modelRetryLabel 倒计时文案', () => {
  const base = {
    notice: '网络波动，重试中 4/5',
    noticeEnglish: 'Network trouble, retrying 4/5',
    errorMessage: 'fetch failed',
    at: 0,
  }

  it('退避期内（retryAt 在未来）明说「x 秒后重试」，x 向下取整', () => {
    const now = 1_000_000
    const retry = { ...base, attempt: 4, maxRetries: 5, retryAt: now + 24_000, inFlight: false }
    expect(modelRetryLabel(retry, now)).toContain('网络波动，重试中 4/5，24 秒后重试')
    const fraction = { ...base, attempt: 4, maxRetries: 5, retryAt: now + 1_500, inFlight: false }
    expect(modelRetryLabel(fraction, now)).toContain('1 秒后重试')
  })

  it('倒计时逐秒递减（同一 retryAt、时间往前走）', () => {
    const retry = { ...base, attempt: 4, maxRetries: 5, retryAt: 60_000, inFlight: false }
    expect(modelRetryLabel(retry, 36_000)).toContain('24 秒后重试')
    expect(modelRetryLabel(retry, 37_000)).toContain('23 秒后重试')
    expect(modelRetryLabel(retry, 59_000)).toContain('1 秒后重试')
  })

  it('phase:end 后（inFlight）不显示秒数，换「正在重试…」', () => {
    const retry = { ...base, attempt: 4, maxRetries: 5, retryAt: 0, inFlight: true }
    const label = modelRetryLabel(retry, 0)
    expect(label).toContain('网络波动，重试中 4/5，正在重试…')
    expect(label).not.toContain('秒后')
  })

  it('retryAt 已过或不足 1 秒 ⇒ 不报「0 秒后重试」这种傻话，按正在重试', () => {
    const past = { ...base, attempt: 4, maxRetries: 5, retryAt: 500, inFlight: false }
    expect(modelRetryLabel(past, 1_000)).toContain('正在重试…')
    expect(modelRetryLabel(past, 1_000)).not.toContain('秒后')
  })

  it('引擎没给 retryAt（0）⇒ 没有倒计时可报，只说正在重试', () => {
    const noRetryAt = { ...base, attempt: 4, maxRetries: 5, retryAt: 0, inFlight: false }
    expect(modelRetryLabel(noRetryAt, 0)).toContain('正在重试…')
  })
})

describe('projectEngineRecoveryEvent', () => {
  it('投影恢复横幅状态并使用引擎自带提示', () => {
    const recovery = projectEngineRecoveryEvent({
      notice: '从断点恢复中',
      noticeEnglish: 'Resuming from where the engine left off',
    })
    expect(recovery?.notice).toBe('从断点恢复中')
    expect(engineRecoveryLabel(recovery!)).toBe('从断点恢复中')
  })

  it('没有可读提示时返回 null，不硬造文案', () => {
    expect(projectEngineRecoveryEvent({})).toBeNull()
  })
})

describe('projectMessageQueuedEvent + messageQueuedLabel', () => {
  it('投影排队位次并给出「当前回合结束后处理」文案', () => {
    const queued = projectMessageQueuedEvent({
      submissionId: 'sub-1',
      position: 2,
      total: 3,
      text: '继续刚才的任务',
      notice: '排队中第 2 位',
      noticeEnglish: 'Queued, position 2 of 3',
    })
    expect(queued).toMatchObject({ position: 2, total: 3, text: '继续刚才的任务', submissionId: 'sub-1' })
    expect(messageQueuedLabel(queued!)).toContain('当前回合结束后处理')
    expect(messageQueuedLabel(queued!)).toContain('第 2 位')
  })

  it('位次缺省按 1，total 不小于 position', () => {
    const queued = projectMessageQueuedEvent({ position: 4 })
    expect(queued?.position).toBe(4)
    expect(queued?.total).toBe(4)
  })
})

describe('queuedNoticeExpired', () => {
  const queued = projectMessageQueuedEvent({
    position: 1, total: 1, text: '排队消息',
  })!

  it('回合结束 ⇒ 过期（running 门兜底）', () => {
    expect(queuedNoticeExpired(queued, false, ['排队消息'])).toBe(true)
  })

  it('还没有队列快照（followUp=null，message_queued 常先于首个 queue_update）⇒ 只看 running', () => {
    expect(queuedNoticeExpired(queued, true, null)).toBe(false)
    expect(queuedNoticeExpired(queued, false, null)).toBe(true)
  })

  it('排队文本仍在 followUp ⇒ 不过期', () => {
    expect(queuedNoticeExpired(queued, true, ['排队消息'])).toBe(false)
  })

  it('文本已从 followUp 消失（被回合消费）⇒ 过期', () => {
    expect(queuedNoticeExpired(queued, true, [])).toBe(true)
    expect(queuedNoticeExpired(queued, true, ['别的消息'])).toBe(true)
  })

  it('事件没给文本时只看 running，不做激进清除', () => {
    const noText = projectMessageQueuedEvent({ position: 1 })!
    expect(queuedNoticeExpired(noText, true, [])).toBe(false)
    expect(queuedNoticeExpired(noText, false, [])).toBe(true)
  })

  it('没有排队状态 ⇒ 过期（getter 直接返回 null）', () => {
    expect(queuedNoticeExpired(null, true, [])).toBe(true)
  })
})

describe('engineStallWarningLabel', () => {
  it('model.stall 自带提示优先，并补硬阈值的实话', () => {
    const label = engineStallWarningLabel({
      at: 1, stage: 'generation', budgetMs: 0, payloadBytes: 0,
      notice: '连接无响应 90 秒', noticeEnglish: 'No response for 90s',
      stalledSeconds: 90, hardKillSeconds: 180,
    }, formatElapsed)
    expect(label).toContain('连接无响应 90 秒')
    expect(label).toContain('180 秒')
    expect(label).toContain('自动断开并重试')
  })

  it('自带提示但没有硬阈值 ⇒ 不硬补', () => {
    const label = engineStallWarningLabel({
      at: 1, stage: 'generation', budgetMs: 0, payloadBytes: 0,
      notice: '连接无响应 90 秒',
    }, formatElapsed)
    expect(label).toBe('连接无响应 90 秒')
  })

  it('turn.stall_warning（预算告警，无自带提示）沿用预算文案', () => {
    const label = engineStallWarningLabel({
      at: 1, stage: 'ttfb', budgetMs: 90_000, payloadBytes: 2 * 1024 * 1024,
    }, formatElapsed)
    expect(label).toContain('等待预算 90s')
    expect(label).toContain('2.0MB')
  })

  it('预算告警无体积 ⇒ 不提体积', () => {
    const label = engineStallWarningLabel({
      at: 1, stage: 'ttfb', budgetMs: 90_000, payloadBytes: 0,
    }, formatElapsed)
    expect(label).toContain('等待预算 90s')
    expect(label).not.toContain('MB')
  })

  it('没有告警 ⇒ 空串', () => {
    expect(engineStallWarningLabel(null, formatElapsed)).toBe('')
  })
})

export type CTFManualStatus = 'not_started' | 'in_progress' | 'paused' | 'completed'

export function ctfManualStatusLabel(status: CTFManualStatus) {
  return ({
    not_started: '未开始',
    in_progress: '进行中',
    paused: '稍后继续',
    completed: '已完成',
  })[status]
}

export function ctfManualStatusFromJobStatus(status: string): CTFManualStatus {
  if (status === 'queued') return 'not_started'
  if (status === 'succeeded') return 'completed'
  if (status === 'failed' || status === 'cancelled') return 'paused'
  return 'in_progress'
}

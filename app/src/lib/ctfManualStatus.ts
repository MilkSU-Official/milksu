import { t } from '@/lib/uiLocale'

export type CTFManualStatus = 'not_started' | 'in_progress' | 'paused' | 'completed'

export function ctfManualStatusLabel(status: CTFManualStatus) {
  return ({
    not_started: t('未开始', 'Not started'),
    in_progress: t('进行中', 'In progress'),
    paused: t('稍后继续', 'Resume later'),
    completed: t('已完成', 'Completed'),
  })[status]
}

export function ctfManualStatusFromJobStatus(status: string): CTFManualStatus {
  if (status === 'queued') return 'not_started'
  if (status === 'succeeded') return 'completed'
  if (status === 'failed' || status === 'cancelled') return 'paused'
  return 'in_progress'
}

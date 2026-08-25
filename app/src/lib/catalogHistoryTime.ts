import { uiLocale } from '@/lib/uiLocale'

export function formatCatalogHistoryTime(value: string | number) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(uiLocale() === 'en' ? 'en-US' : 'zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

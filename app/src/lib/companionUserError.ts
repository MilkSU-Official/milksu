import { explainModelCallFailure, type ModelServiceErrorContext } from './tokenFluxError'
import { t } from './uiLocale'

const SIDECAR_DOWN = /companion sidecar stopped|companion sidecar did not become ready|companion sidecar is not running|companion runtime is not configured|cannot find module.*current-provider-runtime/i

export function explainCompanionError(
  reason: unknown,
  context?: ModelServiceErrorContext,
): string {
  const message = String(reason ?? '').trim()
  if (!message) return ''
  if (SIDECAR_DOWN.test(message)) {
    return t('桌宠暂时连不上。', 'The companion could not start.')
  }
  return explainModelCallFailure(message, context) || message
}

export function companionChatVisibleText(entry: {
  text?: string
  type?: string
  error?: string
}): string {
  const text = String(entry.text ?? '').trim()
  const type = String(entry.type ?? '').trim()
  if (text && text !== type) return text
  return String(entry.error ?? '').trim()
}

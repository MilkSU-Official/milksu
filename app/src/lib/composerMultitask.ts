import { normalizeAgentKernel } from '@/lib/agentKernel'

export function shouldShowMultitaskCapsule(input: {
  kernel?: string | null
  multitask?: boolean | null
}): boolean {
  if (input.multitask !== true) return false
  const raw = String(input.kernel ?? '').trim()
  if (!raw) return false
  const kernel = normalizeAgentKernel(raw)
  return kernel === 'pi' || kernel === 'dsh'
}

export function piMultitaskModelHint(t: (zh: string, en: string) => string): string {
  return t(
    '并行已开。这条消息留在主对话。你可以派一个后台子代理，然后继续回复。要改某个子代理时，先看它的状态，再决定怎么处理。',
    'Multitask is on. This message stays in the main conversation. You may dispatch a background subagent and keep replying. Before changing a subagent, read its status and choose what to do.',
  )
}

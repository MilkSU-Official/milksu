export type AgentKernel = 'pi' | 'dsh'
export type BusySendPolicy = 'interrupt' | 'queue'

/** Factory Settings default for a new conversation. Existing rows keep their kernel. */
export const FACTORY_DEFAULT_KERNEL: AgentKernel = 'pi'
export const FACTORY_DEFAULT_BUSY_SEND: BusySendPolicy = 'interrupt'

export function normalizeBusySend(value: unknown): BusySendPolicy {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'queue' || raw === 'queued' || raw === '排队') return 'queue'
  return 'interrupt'
}

export function defaultBusySend(value?: unknown): BusySendPolicy {
  if (value == null || String(value).trim() === '') return FACTORY_DEFAULT_BUSY_SEND
  return normalizeBusySend(value)
}

export function normalizeAgentKernel(value: unknown): AgentKernel {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'dsh' || raw === 'deepseek' || raw === 'deepseek-harness') return 'dsh'
  return 'pi'
}

export function defaultAgentKernel(value: unknown): AgentKernel {
  const raw = String(value ?? '').trim()
  if (!raw) return FACTORY_DEFAULT_KERNEL
  return normalizeAgentKernel(value)
}

export function conversationKernelLocked(
  messages: Array<{ role?: string; status?: string | null }> | undefined,
): boolean {
  return (messages ?? []).some(message => (
    message.role === 'user' && message.status !== 'queued'
  ))
}

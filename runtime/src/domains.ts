import type { HandlerContext } from './handlers.ts'

export type DomainHandler = (
  ctx: HandlerContext,
  args: unknown[] | undefined,
) => Promise<unknown>

const handlers = new Map<string, DomainHandler>()

export function registerOwnedHandlers(next: Record<string, DomainHandler>): void {
  for (const [name, fn] of Object.entries(next)) {
    handlers.set(name, fn)
  }
}

export function ownedDomainMethod(name: string): DomainHandler | undefined {
  return handlers.get(name)
}

export function isOwnedDomainMethod(name: string): boolean {
  return handlers.has(name)
}

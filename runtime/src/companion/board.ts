import type { BoardSnapshot, ConversationRef, SessionState, Todo } from './types.ts'
import { SESSION_ID } from './types.ts'
import { asObject, firstNonEmpty, newPrefixedId, stringSlice, trimString } from './util.ts'

function cloneTodo(value: Todo): Todo {
  return { ...value, dependsOn: [...(value.dependsOn ?? [])] }
}

export class Board {
  private sessions = new Map<string, SessionState>()
  private todos = new Map<string, Todo>()

  handle(input: Record<string, unknown>): unknown {
    const action = trimString(input.action)
    switch (action) {
      case 'list':
      case '':
        return this.snapshot()
      case 'upsert_todo': {
        const todo = this.upsertTodo({
          id: trimString(input.id),
          title: trimString(input.title),
          targetConversationId: trimString(input.targetConversationId),
          dependsOn: stringSlice(input.dependsOn),
          note: trimString(input.note),
          status: 'open',
        })
        return { todo, board: this.snapshot() }
      }
      case 'close_todo': {
        const todo = this.closeTodo(trimString(input.id), trimString(input.reason))
        return { todo, board: this.snapshot() }
      }
      default:
        throw new Error(`unknown companion_board action ${JSON.stringify(action)}`)
    }
  }

  replaceSessions(refs: ConversationRef[]): void {
    const next = new Map<string, SessionState>()
    for (const ref of refs) {
      const id = trimString(ref.id)
      if (!id) continue
      let status = trimString(ref.status) || 'idle'
      const existing = this.sessions.get(id)
      let title = firstNonEmpty(ref.title ?? '', id)
      if (existing) {
        if (existing.status) status = existing.status
        if (existing.lastError) title = firstNonEmpty(ref.title ?? '', existing.title)
      }
      next.set(id, {
        id,
        title,
        kind: ref.kind,
        status,
        lastError: existing?.lastError,
        archived: ref.archived,
      })
    }
    this.sessions = next
  }

  snapshot(): BoardSnapshot {
    return {
      sessions: [...this.sessions.values()],
      todos: [...this.todos.values()].map(cloneTodo),
    }
  }

  upsertTodo(todo: Partial<Todo> & { title?: string; id?: string }): Todo {
    const incomingTitle = trimString(todo.title)
    if (!incomingTitle && !trimString(todo.id)) throw new Error('todo title is required')
    const id = trimString(todo.id) || newPrefixedId('todo')
    const current = this.todos.get(id)
    const title = incomingTitle || current?.title || ''
    if (!title) throw new Error('todo title is required')
    const next: Todo = {
      id,
      title,
      targetConversationId: trimString(todo.targetConversationId),
      dependsOn: [...(todo.dependsOn ?? [])],
      note: trimString(todo.note),
      reason: current?.reason,
      status: 'open',
      updatedAt: Date.now(),
    }
    if (current?.status === 'closed') {
      next.status = 'open'
      next.reason = ''
    }
    this.todos.set(id, next)
    return cloneTodo(next)
  }

  closeTodo(id: string, reason: string): Todo {
    const key = trimString(id)
    if (!key) throw new Error('todo id is required')
    const current = this.todos.get(key)
    if (!current) throw new Error(`todo ${key} was not found`)
    current.status = 'closed'
    current.reason = trimString(reason)
    current.updatedAt = Date.now()
    this.todos.set(key, current)
    return cloneTodo(current)
  }

  setSessionStatus(conversationId: string, status: string, lastError: string): void {
    const id = trimString(conversationId)
    if (!id || id === SESSION_ID) return
    const session = this.sessions.get(id) ?? { id, title: id, status: 'idle' }
    session.id = id
    if (!session.title) session.title = id
    if (trimString(status)) session.status = status
    session.lastError = trimString(lastError)
    this.sessions.set(id, session)
  }

  recordDispatchFailure(conversationId: string, reason: string): void {
    const id = trimString(conversationId)
    if (!id) return
    const session = this.sessions.get(id) ?? { id, title: id, status: 'idle' }
    session.id = id
    if (!session.title) session.title = id
    session.status = 'dispatch_failed'
    session.lastError = trimString(reason)
    this.sessions.set(id, session)
  }

  replaceTodos(todos: Todo[]): void {
    const next = new Map<string, Todo>()
    for (const todo of todos) {
      const id = trimString(todo.id)
      if (!id) continue
      next.set(id, cloneTodo(todo))
    }
    this.todos = next
  }
}

export function boardHandleInput(board: Board, input: unknown): unknown {
  return board.handle(asObject(input))
}

package companion

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

type Board struct {
	mu       sync.Mutex
	sessions map[string]SessionState
	todos    map[string]Todo
}

func NewBoard() *Board {
	return &Board{
		sessions: make(map[string]SessionState),
		todos:    make(map[string]Todo),
	}
}

func (b *Board) Handle(input map[string]any) (any, error) {
	action := strings.TrimSpace(stringValue(input["action"]))
	switch action {
	case "list", "":
		return b.Snapshot(), nil
	case "upsert_todo":
		todo, err := b.UpsertTodo(Todo{
			ID:                   strings.TrimSpace(stringValue(input["id"])),
			Title:                strings.TrimSpace(stringValue(input["title"])),
			TargetConversationID: strings.TrimSpace(stringValue(input["targetConversationId"])),
			DependsOn:            stringSlice(input["dependsOn"]),
			Note:                 strings.TrimSpace(stringValue(input["note"])),
		})
		if err != nil {
			return nil, err
		}
		return map[string]any{"todo": todo, "board": b.Snapshot()}, nil
	case "close_todo":
		todo, err := b.CloseTodo(
			strings.TrimSpace(stringValue(input["id"])),
			strings.TrimSpace(stringValue(input["reason"])),
		)
		if err != nil {
			return nil, err
		}
		return map[string]any{"todo": todo, "board": b.Snapshot()}, nil
	default:
		return nil, fmt.Errorf("unknown companion_board action %q", action)
	}
}

func (b *Board) ReplaceSessions(refs []ConversationRef) {
	b.mu.Lock()
	defer b.mu.Unlock()
	next := make(map[string]SessionState, len(refs))
	for _, ref := range refs {
		id := strings.TrimSpace(ref.ID)
		if id == "" {
			continue
		}
		status := strings.TrimSpace(ref.Status)
		if status == "" {
			status = "idle"
		}
		if existing, ok := b.sessions[id]; ok {
			if existing.Status != "" {
				status = existing.Status
			}
			if existing.LastError != "" {
				ref.Title = firstNonEmpty(ref.Title, existing.Title)
			}
		}
		next[id] = SessionState{
			ID:        id,
			Title:     firstNonEmpty(ref.Title, id),
			Kind:      ref.Kind,
			Status:    status,
			LastError: b.sessions[id].LastError,
			Archived:  ref.Archived,
		}
	}
	b.sessions = next
}

func (b *Board) Snapshot() BoardSnapshot {
	b.mu.Lock()
	defer b.mu.Unlock()
	sessions := make([]SessionState, 0, len(b.sessions))
	for _, session := range b.sessions {
		sessions = append(sessions, session)
	}
	todos := make([]Todo, 0, len(b.todos))
	for _, todo := range b.todos {
		todos = append(todos, cloneTodo(todo))
	}
	return BoardSnapshot{Sessions: sessions, Todos: todos}
}

func (b *Board) UpsertTodo(todo Todo) (Todo, error) {
	title := strings.TrimSpace(todo.Title)
	if title == "" && strings.TrimSpace(todo.ID) == "" {
		return Todo{}, fmt.Errorf("todo title is required")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	id := strings.TrimSpace(todo.ID)
	if id == "" {
		id = newPrefixedID("todo")
	}
	current, exists := b.todos[id]
	if exists && title == "" {
		title = current.Title
	}
	if title == "" {
		return Todo{}, fmt.Errorf("todo title is required")
	}
	next := Todo{
		ID:                   id,
		Title:                title,
		TargetConversationID: strings.TrimSpace(todo.TargetConversationID),
		DependsOn:            append([]string(nil), todo.DependsOn...),
		Note:                 strings.TrimSpace(todo.Note),
		Reason:               current.Reason,
		Status:               "open",
		UpdatedAt:            time.Now().UnixMilli(),
	}
	if exists && current.Status == "closed" {
		next.Status = "open"
		next.Reason = ""
	}
	b.todos[id] = next
	return cloneTodo(next), nil
}

func (b *Board) CloseTodo(id, reason string) (Todo, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return Todo{}, fmt.Errorf("todo id is required")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	current, exists := b.todos[id]
	if !exists {
		return Todo{}, fmt.Errorf("todo %s was not found", id)
	}
	current.Status = "closed"
	current.Reason = strings.TrimSpace(reason)
	current.UpdatedAt = time.Now().UnixMilli()
	b.todos[id] = current
	return cloneTodo(current), nil
}

func (b *Board) SetSessionStatus(conversationID, status, lastError string) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" || conversationID == SessionID {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	session := b.sessions[conversationID]
	session.ID = conversationID
	if session.Title == "" {
		session.Title = conversationID
	}
	if strings.TrimSpace(status) != "" {
		session.Status = status
	}
	session.LastError = strings.TrimSpace(lastError)
	b.sessions[conversationID] = session
}

func (b *Board) RecordDispatchFailure(conversationID, reason string) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	session := b.sessions[conversationID]
	session.ID = conversationID
	if session.Title == "" {
		session.Title = conversationID
	}
	session.Status = "dispatch_failed"
	session.LastError = strings.TrimSpace(reason)
	b.sessions[conversationID] = session
}

func (b *Board) ReplaceTodos(todos []Todo) {
	b.mu.Lock()
	defer b.mu.Unlock()
	next := make(map[string]Todo, len(todos))
	for _, todo := range todos {
		id := strings.TrimSpace(todo.ID)
		if id == "" {
			continue
		}
		next[id] = cloneTodo(todo)
	}
	b.todos = next
}

func cloneTodo(value Todo) Todo {
	value.DependsOn = append([]string(nil), value.DependsOn...)
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

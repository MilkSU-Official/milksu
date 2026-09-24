package companion

import (
	"context"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/engine"
	"github.com/MilkSU-Official/milksu/internal/jev"
)

type watchedSession struct {
	Title string `json:"title"`
	Task  string `json:"task"`
	Live  bool   `json:"live"`
}

func (r *Runtime) noteDispatch(action string, input map[string]any, result any) {
	if r == nil {
		return
	}
	task := strings.TrimSpace(stringValue(input["text"]))
	if task == "" {
		task = strings.TrimSpace(stringValue(input["firstMessage"]))
	}
	switch action {
	case "stop":
		if dispatch, ok := result.(DispatchResult); ok && dispatch.Accepted && dispatch.Delivered {
			id := strings.TrimSpace(dispatch.ConversationID)
			if id == "" {
				id = strings.TrimSpace(stringValue(input["conversationId"]))
			}
			r.dropWatch(id)
		}
	case "speak", "create_conversation":
		if dispatch, ok := result.(DispatchResult); ok && dispatch.Accepted && dispatch.Delivered {
			r.armWatch(dispatch.ConversationID, dispatch.TargetTitle, task)
		}
	case "speak_many":
		batch, ok := result.(SpeakManyResult)
		if !ok {
			return
		}
		for _, item := range batch.Results {
			if item.Accepted && item.Delivered {
				r.armWatch(item.ConversationID, item.TargetTitle, task)
			}
		}
	}
}

func (r *Runtime) watchSnapshot() map[string]watchedSession {
	if r == nil {
		return nil
	}
	r.watchMu.Lock()
	defer r.watchMu.Unlock()
	if len(r.watches) == 0 {
		return nil
	}
	out := make(map[string]watchedSession, len(r.watches))
	for id, item := range r.watches {
		out[id] = item
	}
	return out
}

func (r *Runtime) armWatch(id, title, task string) {
	id = strings.TrimSpace(id)
	if r == nil || id == "" {
		return
	}
	r.watchMu.Lock()
	if r.watches == nil {
		r.watches = map[string]watchedSession{}
	}
	r.watches[id] = watchedSession{
		Title: strings.TrimSpace(title),
		Task:  strings.TrimSpace(task),
		Live:  false,
	}
	r.watchMu.Unlock()
	r.persistState()
}

func (r *Runtime) dropWatch(id string) {
	id = strings.TrimSpace(id)
	if r == nil || id == "" {
		return
	}
	r.watchMu.Lock()
	delete(r.watches, id)
	r.watchMu.Unlock()
	r.persistState()
}

func (r *Runtime) noteWatchedEvent(event engine.Event) {
	if r == nil {
		return
	}
	id := strings.TrimSpace(event.SessionID)
	r.watchMu.Lock()
	item, ok := r.watches[id]
	r.watchMu.Unlock()
	if !ok {
		return
	}
	kind := ""
	switch event.Type {
	case "assistant.delta", "tool.started", "tool.progress":
		item.Live = true
		r.watchMu.Lock()
		if current, still := r.watches[id]; still {
			current.Live = true
			r.watches[id] = current
		}
		r.watchMu.Unlock()
		return
	case "approval.requested":
		item.Live = true
		kind = "needs_approval"
	case "assistant.settled", "assistant.completed":
		if !item.Live {
			return
		}
		kind = "settled"
	case "engine.error":
		kind = "error"
	case "session.destroyed":
		r.dropWatch(id)
		return
	default:
		return
	}
	r.watchMu.Lock()
	if current, still := r.watches[id]; still {
		current.Live = true
		r.watches[id] = current
		item = current
	} else {
		r.watchMu.Unlock()
		return
	}
	if kind == "settled" || kind == "error" {
		delete(r.watches, id)
	}
	r.watchMu.Unlock()
	if kind == "settled" || kind == "error" {
		r.persistState()
	}
	if !r.taskEventsEnabled() {
		return
	}
	title := item.Title
	task := item.Task
	go r.maybeSpeak(id, title, kind, task)
}

func (r *Runtime) taskEventsEnabled() bool {
	settings := r.resolvedSettings()
	flag := settings.CompanionProactivity.TaskEvents
	return flag == nil || *flag
}

func (r *Runtime) routeIntent(prompt string) map[string]any {
	settings := r.resolvedSettings()
	if settings.Jev == nil || strings.TrimSpace(settings.Jev.APIKey) == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	choice, err := (&jev.Client{Key: settings.Jev.APIKey}).Choice(ctx, strings.TrimSpace(prompt), []string{"闲聊", "深入思考", "长任务"})
	if err != nil {
		return nil
	}
	bucket := map[string]string{"闲聊": "chat", "深入思考": "deep", "长任务": "long"}[strings.TrimSpace(choice)]
	if bucket == "" {
		return nil
	}
	return map[string]any{"bucket": bucket, "source": "jev"}
}

func (r *Runtime) jevJudge() NoulJudge {
	settings := r.resolvedSettings()
	if settings.Jev == nil || strings.TrimSpace(settings.Jev.APIKey) == "" {
		return nil
	}
	client := &jev.Client{Key: settings.Jev.APIKey}
	return func(ctx context.Context, state any, instructions string) (float64, error) {
		return client.Noul(ctx, state, instructions)
	}
}

func (r *Runtime) maybeSpeak(id, title, kind, task string) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if !shouldSpeak(ctx, r.jevJudge(), title, kind, task) {
		return
	}
	locale := config.ResolvedUserInterfaceLocale(r.resolvedSettings())
	r.queueNotice(hostNoticePrompt(title, kind, locale))
	_ = id
}

func (r *Runtime) queueNotice(prompt string) {
	prompt = strings.TrimSpace(prompt)
	if r == nil || prompt == "" {
		return
	}
	r.watchMu.Lock()
	if r.inFlight.Load() {
		r.pendingNotice = prompt
		r.watchMu.Unlock()
		return
	}
	r.pendingNotice = ""
	r.watchMu.Unlock()
	r.deliverNotice(prompt)
}

func (r *Runtime) flushNotice() {
	if r == nil {
		return
	}
	r.watchMu.Lock()
	prompt := r.pendingNotice
	r.pendingNotice = ""
	r.watchMu.Unlock()
	if strings.TrimSpace(prompt) == "" || r.inFlight.Load() {
		if strings.TrimSpace(prompt) != "" {
			r.watchMu.Lock()
			if r.pendingNotice == "" {
				r.pendingNotice = prompt
			}
			r.watchMu.Unlock()
		}
		return
	}
	r.deliverNotice(prompt)
}

func (r *Runtime) deliverNotice(prompt string) {
	r.setInFlight(true)
	if err := r.write(map[string]any{"action": "host_notice", "prompt": prompt}); err != nil {
		r.setInFlight(false)
	}
}

func filterCommitInput(ctx context.Context, judge NoulJudge, input map[string]any) map[string]any {
	if judge == nil || strings.TrimSpace(stringValue(input["action"])) != "commit" {
		return input
	}
	userText := strings.TrimSpace(stringValue(input["userText"]))
	items := commitItems(input["items"])
	kept := make([]MemoryCommit, 0, len(items))
	for _, item := range items {
		if keepMemoryItem(ctx, judge, userText, item) {
			kept = append(kept, item)
		}
	}
	next := map[string]any{}
	for key, value := range input {
		next[key] = value
	}
	raw := make([]any, 0, len(kept))
	for _, item := range kept {
		raw = append(raw, map[string]any{
			"action":     item.Action,
			"existingId": item.ExistingID,
			"title":      item.Title,
			"markdown":   item.Markdown,
			"evidence":   item.Evidence,
		})
	}
	next["items"] = raw
	return next
}

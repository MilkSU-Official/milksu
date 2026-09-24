package companion

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/codingattachment"
	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/engine"
	"github.com/MilkSU-Official/milksu/internal/jev"
)

type watchedSession struct {
	Title       string    `json:"title"`
	Task        string    `json:"task"`
	Live        bool      `json:"live"`
	ProgressAt  time.Time `json:"progressAt,omitempty"`
	StallSpoken bool      `json:"stallSpoken,omitempty"`
	Images      []string  `json:"images,omitempty"`
}

const stallQuiet = 45 * time.Second

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
	r.stopStallTimerLocked(id)
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
	case "tool.completed":
		paths := r.imagePathsFromTool(id, event)
		if len(paths) == 0 {
			return
		}
		r.watchMu.Lock()
		if current, still := r.watches[id]; still {
			current.Live = true
			current.Images = appendUniquePaths(current.Images, paths...)
			r.watches[id] = current
		}
		r.watchMu.Unlock()
		return
	case "assistant.delta", "tool.started", "tool.progress":
		item.Live = true
		r.watchMu.Lock()
		if current, still := r.watches[id]; still {
			current.Live = true
			current.ProgressAt = time.Now()
			current.StallSpoken = false
			r.watches[id] = current
			r.armStallTimerLocked(id)
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
		r.stopStallTimerLocked(id)
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
	images := append([]string(nil), item.Images...)
	go r.maybeSpeak(id, title, kind, task, images)
}

func (r *Runtime) taskEventsEnabled() bool {
	settings := r.resolvedSettings()
	flag := settings.CompanionProactivity.TaskEvents
	return flag == nil || *flag
}

func (r *Runtime) routeDecision(prompt string) map[string]any {
	settings := r.resolvedSettings()
	if settings.Jev == nil || strings.TrimSpace(settings.Jev.APIKey) == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	choice, err := (&jev.Client{Key: settings.Jev.APIKey}).Choice(ctx, strings.TrimSpace(prompt),
		"把这条用户消息分成且只分成一档。",
		map[string]string{
			"chat": "打招呼、闲谈或一句话就能回完的短问，不改文件，也不开新会话。",
			"deep": "需要想清楚再用几句答完的问题，仍然停在这一轮，不改仓库、不派新会话。",
			"long": "要在仓库里改文件、跑命令或做完才算结束的活，应该派到新的编码会话。",
		},
	)
	if err != nil {
		return nil
	}
	bucket := map[string]string{"chat": "chat", "deep": "deep", "long": "long"}[strings.TrimSpace(choice)]
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

func (r *Runtime) maybeSpeak(id, title, kind, task string, images []string) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if !shouldSpeak(ctx, r.jevJudge(), title, kind, task) {
		return
	}
	locale := config.ResolvedUserInterfaceLocale(r.resolvedSettings())
	r.queueNotice(hostNoticePrompt(title, kind, locale), r.importWatchedImages(images))
	_ = id
}

func (r *Runtime) queueNotice(prompt string, images ...[]codingattachment.Attachment) {
	prompt = strings.TrimSpace(prompt)
	if r == nil || prompt == "" {
		return
	}
	var attached []codingattachment.Attachment
	if len(images) > 0 {
		attached = images[0]
	}
	r.watchMu.Lock()
	r.pendingNotice = mergeHostNotice(r.pendingNotice, prompt)
	r.pendingImages = mergeNoticeImages(r.pendingImages, attached)
	if r.inFlight.Load() {
		r.watchMu.Unlock()
		return
	}
	merged := r.pendingNotice
	mergedImages := r.pendingImages
	r.pendingNotice = ""
	r.pendingImages = nil
	r.inFlight.Store(true)
	r.watchMu.Unlock()
	r.writeNotice(merged, mergedImages)
}

func (r *Runtime) flushNotice() {
	if r == nil {
		return
	}
	r.watchMu.Lock()
	prompt := r.pendingNotice
	images := r.pendingImages
	r.pendingNotice = ""
	r.pendingImages = nil
	if strings.TrimSpace(prompt) == "" || r.inFlight.Load() {
		if strings.TrimSpace(prompt) != "" {
			r.pendingNotice = mergeHostNotice(r.pendingNotice, prompt)
			r.pendingImages = mergeNoticeImages(images, r.pendingImages)
		}
		r.watchMu.Unlock()
		return
	}
	r.inFlight.Store(true)
	r.watchMu.Unlock()
	r.writeNotice(prompt, images)
}

func (r *Runtime) writeNotice(prompt string, images []codingattachment.Attachment) {
	command := map[string]any{"action": "host_notice", "prompt": prompt}
	if len(images) > 0 {
		locale := config.ResolvedUserInterfaceLocale(r.resolvedSettings())
		command["prompt"] = prompt + "\n" + imageHandoffLine(locale)
		command["attachments"] = images
	}
	if err := r.write(command); err != nil {
		r.watchMu.Lock()
		r.pendingNotice = mergeHostNotice(prompt, r.pendingNotice)
		r.pendingImages = mergeNoticeImages(images, r.pendingImages)
		r.inFlight.Store(false)
		r.watchMu.Unlock()
	}
}

func (r *Runtime) markSpeaking() {
	if r == nil {
		return
	}
	r.watchMu.Lock()
	r.inFlight.Store(true)
	r.watchMu.Unlock()
}

func (r *Runtime) imagePathsFromTool(id string, event engine.Event) []string {
	relative := imageReceiptPaths(event.ToolName, event.Text)
	if len(relative) == 0 || r == nil || r.catalog == nil {
		return nil
	}
	ref, err := r.catalog.Lookup(id)
	if err != nil {
		return nil
	}
	var paths []string
	for _, rel := range relative {
		if full, ok := resolveWatchedImage(ref.Workspace, rel); ok {
			paths = append(paths, full)
		}
	}
	return paths
}

func (r *Runtime) importWatchedImages(paths []string) []codingattachment.Attachment {
	if r == nil || r.importImages == nil || len(paths) == 0 {
		return nil
	}
	if len(paths) > codingattachment.MaxCount {
		paths = paths[:codingattachment.MaxCount]
	}
	imported, err := r.importImages(paths)
	if err != nil || len(imported) == 0 {
		return nil
	}
	return imported
}

func imageReceiptPaths(toolName, text string) []string {
	if !strings.EqualFold(strings.TrimSpace(toolName), "milksu_imagegen") {
		return nil
	}
	start := strings.Index(text, "{")
	if start < 0 {
		return nil
	}
	var row struct {
		Status string `json:"status"`
		Output struct {
			Path string `json:"path"`
		} `json:"output"`
	}
	if json.Unmarshal([]byte(text[start:]), &row) != nil || row.Status != "completed" {
		return nil
	}
	path := strings.TrimSpace(strings.ReplaceAll(row.Output.Path, "\\", "/"))
	if path == "" || strings.HasPrefix(path, "/") || filepath.IsAbs(path) || strings.Contains(path, "..") {
		return nil
	}
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif":
		return []string{path}
	default:
		return nil
	}
}

func resolveWatchedImage(workspace, rel string) (string, bool) {
	workspace = filepath.Clean(strings.TrimSpace(workspace))
	if workspace == "" || workspace == "." {
		return "", false
	}
	full := filepath.Clean(filepath.Join(workspace, filepath.FromSlash(rel)))
	prefix := workspace + string(os.PathSeparator)
	if full != workspace && !strings.HasPrefix(full, prefix) {
		return "", false
	}
	info, err := os.Lstat(full)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", false
	}
	return full, true
}

func appendUniquePaths(current []string, extra ...string) []string {
	seen := map[string]bool{}
	for _, path := range current {
		seen[path] = true
	}
	for _, path := range extra {
		if path == "" || seen[path] {
			continue
		}
		seen[path] = true
		current = append(current, path)
	}
	return current
}

func mergeNoticeImages(current, extra []codingattachment.Attachment) []codingattachment.Attachment {
	seen := map[string]bool{}
	merged := make([]codingattachment.Attachment, 0, len(current)+len(extra))
	for _, item := range append(append([]codingattachment.Attachment{}, current...), extra...) {
		key := item.SHA256 + ":" + item.Name
		if item.SHA256 == "" || seen[key] {
			continue
		}
		seen[key] = true
		merged = append(merged, item)
		if len(merged) >= codingattachment.MaxCount {
			break
		}
	}
	return merged
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

func (r *Runtime) armStallTimerLocked(id string) {
	if r.stallTimers == nil {
		r.stallTimers = map[string]*time.Timer{}
	}
	if timer := r.stallTimers[id]; timer != nil {
		timer.Stop()
	}
	r.stallTimers[id] = time.AfterFunc(stallQuiet, func() {
		r.fireStall(id)
	})
}

func (r *Runtime) stopStallTimerLocked(id string) {
	if timer := r.stallTimers[id]; timer != nil {
		timer.Stop()
	}
	delete(r.stallTimers, id)
}

func (r *Runtime) fireStall(id string) {
	r.watchMu.Lock()
	item, ok := r.watches[id]
	if !ok || !item.Live || item.StallSpoken || time.Since(item.ProgressAt) < stallQuiet {
		r.watchMu.Unlock()
		return
	}
	item.StallSpoken = true
	r.watches[id] = item
	delete(r.stallTimers, id)
	r.watchMu.Unlock()
	if !r.taskEventsEnabled() {
		return
	}
	r.maybeSpeak(id, item.Title, "stall", item.Task, nil)
}

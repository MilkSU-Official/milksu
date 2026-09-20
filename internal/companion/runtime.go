package companion

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/engine"
)

type RuntimeOptions struct {
	AgentDir         string
	StatePath        string
	SidecarDirectory string
	Settings         func() config.AppSettings
	Catalog          Catalog
	Speaker          Speaker
	Control          SessionControl
	Searcher         SessionSearcher
	Emit             func(engine.Event)
	Start            func(config.AppSettings, string, string) (*exec.Cmd, io.WriteCloser, io.ReadCloser, error)
}

type persistedState struct {
	Todos      []Todo                    `json:"todos"`
	Pending    []MemoryProposal          `json:"pending"`
	Approved   []ApprovedMemory          `json:"approved"`
	Forgotten  []string                  `json:"forgotten"`
	Deliveries map[string]DispatchResult `json:"deliveries"`
}

type Runtime struct {
	mu               sync.Mutex
	agentDir         string
	statePath        string
	sidecarDirectory string
	settings         func() config.AppSettings
	catalog          Catalog
	start            func(config.AppSettings, string, string) (*exec.Cmd, io.WriteCloser, io.ReadCloser, error)
	emit             func(engine.Event)

	board      *Board
	dispatcher *Dispatcher
	memory     *Memory

	pendingConfirms map[string]parkedConfirm

	command *exec.Cmd
	stdin   io.WriteCloser
	ready   bool
	lastErr string
}

type parkedConfirm struct {
	requestID string
	input     map[string]any
	title     string
}

func NewRuntime(options RuntimeOptions) *Runtime {
	board := NewBoard()
	memory := NewMemory(options.Searcher, options.Catalog)
	runtime := &Runtime{
		agentDir:         options.AgentDir,
		statePath:        options.StatePath,
		sidecarDirectory: options.SidecarDirectory,
		settings:         options.Settings,
		catalog:          options.Catalog,
		start:            options.Start,
		emit:             options.Emit,
		board:            board,
		memory:           memory,
	}
	if runtime.start == nil {
		runtime.start = engine.OpenCompanionSidecar
	}
	runtime.dispatcher = NewDispatcher(options.Catalog, options.Speaker, board, runtime.dispatchEnabled)
	runtime.dispatcher.SetControl(options.Control)
	runtime.pendingConfirms = map[string]parkedConfirm{}
	runtime.loadState()
	return runtime
}

func (r *Runtime) Ensure() (Status, error) {
	r.refreshBoard()
	status := r.Status()
	if status.Ready {
		return status, nil
	}
	if err := r.startLocked(); err != nil {
		return r.Status(), err
	}
	return r.Status(), nil
}

func (r *Runtime) Send(prompt string) error {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return fmt.Errorf("companion prompt is required")
	}
	if _, err := r.Ensure(); err != nil {
		return err
	}
	r.refreshBoard()
	selection := r.selection()
	command := map[string]any{
		"action":              "send_message",
		"prompt":              prompt,
		"provider":            selection.Provider,
		"model":               selection.Model,
		"source":              selection.Source,
		"boardSnapshot":       r.board.Snapshot(),
		"semanticMemories":    r.semanticPayload(),
		"episodicRecalls":     []any{},
		"memorySearchEnabled": r.memorySearchEnabled(),
	}
	if custom := engine.CompanionCustomProvider(r.resolvedSettings()); custom != nil {
		command["customProvider"] = custom
	}
	return r.write(command)
}

func (r *Runtime) Stop() error {
	r.mu.Lock()
	pending := r.takeAllParkedLocked()
	err := r.stopLocked()
	r.mu.Unlock()
	r.finishParked(pending, "companion sidecar stopped")
	return err
}

func (r *Runtime) Invalidate() {
	r.mu.Lock()
	pending := r.takeAllParkedLocked()
	_ = r.stopLocked()
	r.mu.Unlock()
	r.finishParked(pending, "companion sidecar stopped")
}

func mapString(input map[string]any, key string) string {
	if input == nil {
		return ""
	}
	value, ok := input[key]
	if !ok || value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func pendingConfirmFromParked(pending parkedConfirm) *PendingConfirm {
	if pending.requestID == "" && len(pending.input) == 0 {
		return nil
	}
	input := pending.input
	hostID := mapString(input, "hostRequestId")
	if hostID == "" {
		hostID = strings.TrimSpace(pending.requestID)
	}
	action := mapString(input, "action")
	if action == "" {
		action = "stop"
	}
	return &PendingConfirm{
		Action:         action,
		ConversationID: mapString(input, "conversationId"),
		Text:           mapString(input, "text"),
		IdempotencyKey: mapString(input, "idempotencyKey"),
		Mode:           mapString(input, "mode"),
		HostRequestID:  hostID,
		TargetTitle:    pending.title,
	}
}

func (r *Runtime) Status() Status {
	selection := r.selection()
	r.mu.Lock()
	defer r.mu.Unlock()
	status := Status{
		Ready:    r.ready,
		Provider: selection.Provider,
		Model:    selection.Model,
		Error:    r.lastErr,
	}
	for _, pending := range r.pendingConfirms {
		status.PendingConfirm = pendingConfirmFromParked(pending)
		break
	}
	return status
}

func (r *Runtime) BoardSnapshot() BoardSnapshot {
	r.refreshBoard()
	return r.board.Snapshot()
}

func (r *Runtime) SetControl(control SessionControl) {
	if r == nil || r.dispatcher == nil {
		return
	}
	r.dispatcher.SetControl(control)
}

func (r *Runtime) ObserveEngineEvent(event engine.Event) {
	sessionID := strings.TrimSpace(event.SessionID)
	if sessionID == "" || sessionID == SessionID {
		return
	}
	switch event.Type {
	case "assistant.delta", "tool.started", "tool.progress":
		r.board.SetSessionStatus(sessionID, "running", "")
	case "approval.requested":
		r.board.SetSessionStatus(sessionID, "needs_approval", "")
	case "assistant.settled", "assistant.completed":
		r.board.SetSessionStatus(sessionID, "idle", "")
	case "engine.error":
		r.board.SetSessionStatus(sessionID, "error", event.Error)
	case "engine.stopped", "session.destroyed":
		r.board.SetSessionStatus(sessionID, "idle", "")
	}
}

func (r *Runtime) Transcript(limit int, cursor *TranscriptCursor, before bool) (TranscriptPage, error) {
	path, err := FindCompanionSessionFile(r.agentDir)
	if err != nil {
		return TranscriptPage{}, err
	}
	page, err := ReadTranscriptPage(path, limit, cursor, before)
	if err != nil {
		return TranscriptPage{}, err
	}
	page.File = filepath.Base(page.File)
	return page, nil
}

func (r *Runtime) ArchiveTranscript() (CompanionArchive, error) {
	path, err := FindCompanionSessionFile(r.agentDir)
	if err != nil {
		return CompanionArchive{}, err
	}
	if strings.TrimSpace(path) == "" {
		return CompanionArchive{}, fmt.Errorf("no companion transcript to archive")
	}
	archived, err := ArchiveCompanionFile(r.agentDir, path)
	if err != nil {
		return CompanionArchive{}, err
	}
	r.Invalidate()
	return archived, nil
}

func (r *Runtime) Archives() ([]CompanionArchive, error) {
	return ListCompanionArchives(r.agentDir)
}

func (r *Runtime) DeleteArchive(name string) error {
	return DeleteCompanionArchive(r.agentDir, name)
}

func (r *Runtime) MemorySnapshot() MemorySnapshot {
	if r.memory == nil {
		return MemorySnapshot{}
	}
	return r.memory.Snapshot()
}

func (r *Runtime) ApproveMemory(id string) (ApprovedMemory, error) {
	if r.memory == nil {
		return ApprovedMemory{}, fmt.Errorf("companion memory is not configured")
	}
	approved, err := r.memory.Approve(id)
	if err != nil {
		return ApprovedMemory{}, err
	}
	r.persistState()
	return approved, nil
}

func (r *Runtime) ForgetMemory(id string) error {
	if r.memory == nil {
		return fmt.Errorf("companion memory is not configured")
	}
	if _, err := r.memory.Forget(id); err != nil {
		return err
	}
	r.persistState()
	return nil
}

func (r *Runtime) ConfirmDispatch(action, conversationID, text, idempotencyKey, mode, hostRequestID string, accepted bool) (DispatchResult, error) {
	if r.dispatcher == nil {
		return DispatchResult{}, fmt.Errorf("companion dispatcher is not configured")
	}
	pending := r.takeParked(hostRequestID)
	if !accepted {
		result := DispatchResult{
			Accepted:    false,
			Delivered:   false,
			TargetTitle: pending.title,
			Error:       "user declined",
		}
		if pending.requestID != "" {
			r.respondHost(pending.requestID, result, nil)
		}
		return result, nil
	}
	r.refreshBoard()
	var result DispatchResult
	switch strings.TrimSpace(action) {
	case "stop":
		result = r.dispatcher.Stop(StopRequest{
			ConversationID: conversationID,
			IdempotencyKey: idempotencyKey,
			Confirmed:      true,
		})
	case "speak", "steer":
		if mode == "" {
			mode = "steer"
		}
		result = r.dispatcher.Speak(SpeakRequest{
			ConversationID: conversationID,
			Text:           text,
			IdempotencyKey: idempotencyKey,
			Mode:           mode,
			Confirmed:      true,
		})
	default:
		return DispatchResult{}, fmt.Errorf("unknown companion confirm action %q", action)
	}
	r.persistState()
	if pending.requestID != "" {
		r.respondHost(pending.requestID, result, nil)
	}
	return result, nil
}

func (r *Runtime) startLocked() error {
	r.mu.Lock()
	if r.ready && r.command != nil {
		r.mu.Unlock()
		return nil
	}
	if err := os.MkdirAll(r.agentDir, 0o700); err != nil {
		r.lastErr = err.Error()
		r.mu.Unlock()
		return err
	}
	settings := r.resolvedSettings()
	command, stdin, stdout, err := r.start(settings, r.sidecarDirectory, r.agentDir)
	if err != nil {
		r.lastErr = err.Error()
		r.mu.Unlock()
		return err
	}
	r.command = command
	r.stdin = stdin
	r.ready = false
	r.lastErr = ""
	r.mu.Unlock()

	go r.readEvents(stdout)
	selection := r.selection()
	create := map[string]any{
		"action":              "create_session",
		"provider":            selection.Provider,
		"model":               selection.Model,
		"source":              selection.Source,
		"memorySearchEnabled": r.memorySearchEnabled(),
	}
	if custom := engine.CompanionCustomProvider(settings); custom != nil {
		create["customProvider"] = custom
	}
	if err := r.write(create); err != nil {
		r.mu.Lock()
		r.lastErr = err.Error()
		pending := r.takeAllParkedLocked()
		_ = r.stopLocked()
		r.mu.Unlock()
		r.finishParked(pending, err.Error())
		return err
	}
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		r.mu.Lock()
		ready := r.ready
		lastErr := r.lastErr
		r.mu.Unlock()
		if lastErr != "" && !ready {
			return fmt.Errorf("%s", lastErr)
		}
		if ready {
			return nil
		}
		time.Sleep(20 * time.Millisecond)
	}
	return fmt.Errorf("companion sidecar did not become ready")
}

func (r *Runtime) stopLocked() error {
	if r.stdin != nil {
		_ = writeJSON(r.stdin, map[string]any{"action": "shutdown"})
		_ = r.stdin.Close()
		r.stdin = nil
	}
	if r.command != nil && r.command.Process != nil {
		_ = r.command.Process.Kill()
		_, _ = r.command.Process.Wait()
	}
	r.command = nil
	r.ready = false
	return nil
}

func (r *Runtime) write(value any) error {
	r.mu.Lock()
	stdin := r.stdin
	r.mu.Unlock()
	if stdin == nil {
		return fmt.Errorf("companion sidecar is not running")
	}
	return writeJSON(stdin, value)
}

func (r *Runtime) readEvents(stdout io.ReadCloser) {
	defer stdout.Close()
	scanner := bufio.NewScanner(stdout)
	buffer := make([]byte, 64*1024)
	scanner.Buffer(buffer, 4*1024*1024)
	for scanner.Scan() {
		var raw map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &raw); err != nil {
			r.emitEvent(engine.Event{Type: "engine.protocol_error", Error: err.Error()})
			continue
		}
		eventType := strings.TrimSpace(stringValue(raw["type"]))
		if eventType == "companion_host" {
			go r.answerHost(raw)
			continue
		}
		if eventType == "ready" {
			r.mu.Lock()
			r.ready = true
			r.lastErr = ""
			r.mu.Unlock()
		}
		if eventType == "error" {
			r.mu.Lock()
			r.lastErr = strings.TrimSpace(stringValue(raw["error"]))
			r.mu.Unlock()
		}
		r.emitEvent(mapCompanionEvent(raw))
	}
	r.mu.Lock()
	r.ready = false
	if r.lastErr == "" {
		r.lastErr = "companion sidecar stopped"
	}
	r.command = nil
	r.stdin = nil
	pending := r.takeAllParkedLocked()
	r.mu.Unlock()
	r.finishParked(pending, "companion sidecar stopped")
}

func (r *Runtime) answerHost(raw map[string]any) {
	requestID := strings.TrimSpace(stringValue(raw["requestId"]))
	action := strings.TrimSpace(stringValue(raw["action"]))
	input, _ := raw["input"].(map[string]any)
	if input == nil {
		input = map[string]any{}
	}
	if action == "dispatch" {
		parked, result, err := r.dispatchHost(requestID, input)
		if parked {
			return
		}
		r.respondHost(requestID, result, err)
		return
	}
	result, err := r.handleHost(action, input)
	r.respondHost(requestID, result, err)
}

func (r *Runtime) respondHost(requestID string, result any, err error) {
	if strings.TrimSpace(requestID) == "" {
		return
	}
	response := map[string]any{
		"action":    "companion_host_response",
		"requestId": requestID,
		"ok":        err == nil,
	}
	if err != nil {
		response["error"] = err.Error()
	} else {
		response["result"] = result
	}
	if writeErr := r.write(response); writeErr != nil && r.emit != nil {
		r.emitEvent(engine.Event{Type: "engine.error", Error: writeErr.Error()})
	}
}

func (r *Runtime) dispatchHost(requestID string, input map[string]any) (bool, any, error) {
	result, err := r.dispatcher.Handle(input)
	r.persistState()
	if err != nil {
		return false, result, err
	}
	dispatch, ok := result.(DispatchResult)
	if !ok || !dispatch.NeedsConfirmation {
		return false, result, nil
	}
	r.parkConfirm(requestID, input, dispatch.TargetTitle)
	payload := map[string]any{}
	for key, value := range input {
		payload[key] = value
	}
	payload["hostRequestId"] = requestID
	encoded, _ := json.Marshal(payload)
	r.emitEvent(engine.Event{
		Type:      "companion.confirm",
		RequestID: requestID,
		Input:     string(encoded),
		Notice:    dispatch.TargetTitle,
	})
	return true, nil, nil
}

func (r *Runtime) parkConfirm(requestID string, input map[string]any, title string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.pendingConfirms == nil {
		r.pendingConfirms = map[string]parkedConfirm{}
	}
	r.pendingConfirms[requestID] = parkedConfirm{
		requestID: requestID,
		input:     input,
		title:     title,
	}
}

func (r *Runtime) takeParked(hostRequestID string) parkedConfirm {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.pendingConfirms == nil {
		return parkedConfirm{}
	}
	hostRequestID = strings.TrimSpace(hostRequestID)
	if hostRequestID != "" {
		pending := r.pendingConfirms[hostRequestID]
		delete(r.pendingConfirms, hostRequestID)
		return pending
	}
	if len(r.pendingConfirms) == 1 {
		for key, pending := range r.pendingConfirms {
			delete(r.pendingConfirms, key)
			return pending
		}
	}
	return parkedConfirm{}
}

func (r *Runtime) takeAllParkedLocked() map[string]parkedConfirm {
	pending := r.pendingConfirms
	r.pendingConfirms = map[string]parkedConfirm{}
	return pending
}

func (r *Runtime) finishParked(pending map[string]parkedConfirm, reason string) {
	for _, item := range pending {
		r.respondHost(item.requestID, DispatchResult{
			Accepted:    false,
			Delivered:   false,
			TargetTitle: item.title,
			Error:       reason,
		}, nil)
	}
}

func (r *Runtime) handleHost(action string, input map[string]any) (any, error) {
	r.refreshBoard()
	switch action {
	case "board":
		return r.board.Handle(input)
	case "dispatch":
		_, result, err := r.dispatchHost("", input)
		return result, err
	case "memory":
		if strings.TrimSpace(stringValue(input["action"])) == "search" && !r.memorySearchEnabled() {
			return map[string]any{"written": false, "results": []MemoryHit{}}, nil
		}
		result, err := r.memory.Handle(input)
		r.persistState()
		return result, err
	default:
		return nil, fmt.Errorf("unknown companion host action %q", action)
	}
}

func (r *Runtime) refreshBoard() {
	if r.catalog == nil || r.board == nil {
		return
	}
	active, err := r.catalog.ListActive()
	if err != nil {
		return
	}
	r.board.ReplaceSessions(active)
}

func (r *Runtime) semanticPayload() []map[string]string {
	approved := r.memory.ApprovedForAssembly()
	payload := make([]map[string]string, 0, len(approved))
	for _, memory := range approved {
		payload = append(payload, map[string]string{
			"title":    memory.Title,
			"markdown": memory.Markdown,
		})
	}
	return payload
}

func (r *Runtime) dispatchEnabled() bool {
	settings := r.resolvedSettings()
	return config.CompanionDispatchEnabled(settings)
}

func (r *Runtime) memorySearchEnabled() bool {
	return config.CompanionMemoryEnabled(r.resolvedSettings())
}

func (r *Runtime) resolvedSettings() config.AppSettings {
	if r.settings == nil {
		return config.DefaultSettings()
	}
	return r.settings()
}

func (r *Runtime) selection() config.CompanionModelSelection {
	return config.ResolveCompanionModel(r.resolvedSettings())
}

func (r *Runtime) emitEvent(event engine.Event) {
	if r.emit == nil {
		return
	}
	event.Engine = SessionID
	if event.SessionID == "" {
		event.SessionID = SessionID
	}
	if event.SchemaVersion == 0 {
		event.SchemaVersion = 1
	}
	if event.Timestamp == "" {
		event.Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
	}
	r.emit(event)
}

func (r *Runtime) loadState() {
	if strings.TrimSpace(r.statePath) == "" {
		return
	}
	data, err := os.ReadFile(r.statePath)
	if err != nil {
		return
	}
	var state persistedState
	if json.Unmarshal(data, &state) != nil {
		return
	}
	r.board.ReplaceTodos(state.Todos)
	r.memory.Replace(state.Pending, state.Approved, state.Forgotten)
	r.dispatcher.ReplaceDeliveries(state.Deliveries)
}

func (r *Runtime) persistState() {
	if strings.TrimSpace(r.statePath) == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(r.statePath), 0o700); err != nil {
		return
	}
	pending, approved, forgotten := r.memory.Persist()
	state := persistedState{
		Todos:      r.board.Snapshot().Todos,
		Pending:    pending,
		Approved:   approved,
		Forgotten:  forgotten,
		Deliveries: r.dispatcher.Deliveries(),
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(r.statePath, data, 0o600)
}

func writeJSON(writer io.Writer, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = writer.Write(data)
	return err
}

func mapCompanionEvent(raw map[string]any) engine.Event {
	event := engine.Event{
		Engine:    SessionID,
		SessionID: SessionID,
		Text:      stringValue(raw["delta"]),
		Error:     stringValue(raw["error"]),
		Reason:    stringValue(raw["reason"]),
	}
	switch strings.TrimSpace(stringValue(raw["type"])) {
	case "hello":
		event.Type = "companion.hello"
	case "ready":
		event.Type = "session.ready"
		event.Resumed = boolValue(raw["resumed"])
	case "text_delta":
		event.Type = "assistant.delta"
	case "turn_settled":
		event.Type = "assistant.settled"
		event.Done = true
		event.Aborted = boolValue(raw["aborted"])
	case "model_selected":
		event.Type = "session.model_selected"
	case "error":
		event.Type = "engine.error"
	default:
		event.Type = "companion." + strings.TrimSpace(stringValue(raw["type"]))
	}
	return event
}

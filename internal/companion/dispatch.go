package companion

import (
	"fmt"
	"strings"
	"sync"
)

type Dispatcher struct {
	mu         sync.Mutex
	catalog    Catalog
	speaker    Speaker
	control    SessionControl
	board      *Board
	enabled    func() bool
	deliveries map[string]DispatchResult
}

func NewDispatcher(catalog Catalog, speaker Speaker, board *Board, enabled func() bool) *Dispatcher {
	return &Dispatcher{
		catalog:    catalog,
		speaker:    speaker,
		board:      board,
		enabled:    enabled,
		deliveries: make(map[string]DispatchResult),
	}
}

func (d *Dispatcher) SetControl(control SessionControl) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.control = control
}

func (d *Dispatcher) Handle(input map[string]any) (any, error) {
	action := strings.TrimSpace(stringValue(input["action"]))
	switch action {
	case "speak":
		return d.Speak(SpeakRequest{
			ConversationID: strings.TrimSpace(stringValue(input["conversationId"])),
			Text:           strings.TrimSpace(stringValue(input["text"])),
			IdempotencyKey: strings.TrimSpace(stringValue(input["idempotencyKey"])),
			Mode:           strings.TrimSpace(stringValue(input["mode"])),
			Confirmed:      boolValue(input["confirmed"]),
		}), nil
	case "create_conversation":
		return d.CreateConversation(CreateRequest{
			Kind:           strings.TrimSpace(stringValue(input["kind"])),
			WorkspacePath:  strings.TrimSpace(stringValue(input["workspacePath"])),
			Title:          strings.TrimSpace(stringValue(input["title"])),
			FirstMessage:   strings.TrimSpace(stringValue(input["firstMessage"])),
			IdempotencyKey: strings.TrimSpace(stringValue(input["idempotencyKey"])),
		}), nil
	case "stop":
		return d.Stop(StopRequest{
			ConversationID: strings.TrimSpace(stringValue(input["conversationId"])),
			IdempotencyKey: strings.TrimSpace(stringValue(input["idempotencyKey"])),
			Confirmed:      boolValue(input["confirmed"]),
		}), nil
	case "speak_many":
		return d.SpeakMany(SpeakManyRequest{
			ConversationIDs: stringSlice(input["conversationIds"]),
			Text:            strings.TrimSpace(stringValue(input["text"])),
			IdempotencyKey:  strings.TrimSpace(stringValue(input["idempotencyKey"])),
			Mode:            strings.TrimSpace(stringValue(input["mode"])),
			Confirmed:       boolValue(input["confirmed"]),
		}), nil
	default:
		return nil, fmt.Errorf("unknown companion_dispatch action %q", action)
	}
}

type SpeakRequest struct {
	ConversationID string
	Text           string
	IdempotencyKey string
	Mode           string
	Confirmed      bool
}

type CreateRequest struct {
	Kind           string
	WorkspacePath  string
	Title          string
	FirstMessage   string
	IdempotencyKey string
}

type StopRequest struct {
	ConversationID string
	IdempotencyKey string
	Confirmed      bool
}

func (d *Dispatcher) Speak(req SpeakRequest) DispatchResult {
	if result, ok := d.replay(req.IdempotencyKey); ok {
		return result
	}
	if !d.dispatchEnabled() {
		return d.fail(req.IdempotencyKey, "", "companion dispatch is turned off")
	}
	if req.ConversationID == "" {
		return d.fail(req.IdempotencyKey, "", "speak requires conversationId")
	}
	if req.Text == "" {
		return d.fail(req.IdempotencyKey, "", "speak requires text")
	}
	if req.IdempotencyKey == "" {
		return d.fail(req.IdempotencyKey, "", "speak requires idempotencyKey")
	}
	ref, err := d.catalog.Lookup(req.ConversationID)
	if err != nil {
		return d.fail(req.IdempotencyKey, "", "conversation was not found")
	}
	if ref.Archived {
		return d.fail(req.IdempotencyKey, ref.Title, "conversation is archived")
	}
	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = "queue"
	}
	if mode == "steer" && !req.Confirmed {
		return DispatchResult{
			Accepted:          false,
			Delivered:         false,
			TargetTitle:       ref.Title,
			NeedsConfirmation: true,
		}
	}
	if mode != "queue" && mode != "steer" {
		return d.fail(req.IdempotencyKey, ref.Title, "speak mode must be queue or steer")
	}
	if mode == "steer" {
		if d.speaker == nil {
			return d.recordFailure(req.IdempotencyKey, ref, "", "delivery is not configured")
		}
		entryID, produced, err := d.speaker.DeliverSteer(ref.ID, req.Text)
		if err != nil {
			return d.recordFailure(req.IdempotencyKey, ref, "", err.Error())
		}
		if !produced {
			return d.recordFailure(req.IdempotencyKey, ref, entryID, "target conversation did not receive a user entry")
		}
		result := DispatchResult{
			Accepted:    true,
			Delivered:   true,
			TargetTitle: ref.Title,
			EntryID:     entryID,
		}
		d.store(req.IdempotencyKey, result)
		return result
	}
	if d.speaker == nil {
		return d.recordFailure(req.IdempotencyKey, ref, "", "delivery is not configured")
	}
	entryID, produced, err := d.speaker.DeliverSpeak(ref.ID, req.Text)
	if err != nil {
		return d.recordFailure(req.IdempotencyKey, ref, "", err.Error())
	}
	if !produced {
		return d.recordFailure(req.IdempotencyKey, ref, entryID, "target conversation did not receive a user entry")
	}
	result := DispatchResult{
		Accepted:    true,
		Delivered:   true,
		TargetTitle: ref.Title,
		EntryID:     entryID,
	}
	d.store(req.IdempotencyKey, result)
	return result
}

const maxSpeakMany = 8

type SpeakManyRequest struct {
	ConversationIDs []string
	Text            string
	IdempotencyKey  string
	Mode            string
	Confirmed       bool
}

type SpeakManyResult struct {
	Accepted          bool             `json:"accepted"`
	NeedsConfirmation bool             `json:"needsConfirmation,omitempty"`
	TargetTitle       string           `json:"targetTitle,omitempty"`
	Results           []DispatchResult `json:"results,omitempty"`
	Error             string           `json:"error,omitempty"`
}

func (d *Dispatcher) SpeakMany(req SpeakManyRequest) any {
	if result, ok := d.replay(req.IdempotencyKey); ok {
		return result
	}
	if !d.dispatchEnabled() {
		return d.fail(req.IdempotencyKey, "", "companion dispatch is turned off")
	}
	if strings.TrimSpace(req.Text) == "" {
		return d.fail(req.IdempotencyKey, "", "speak_many requires text")
	}
	if req.IdempotencyKey == "" {
		return d.fail(req.IdempotencyKey, "", "speak_many requires idempotencyKey")
	}
	ids := uniqueIDs(req.ConversationIDs)
	if len(ids) == 0 {
		return d.fail(req.IdempotencyKey, "", "speak_many requires conversationIds")
	}
	if len(ids) > maxSpeakMany {
		return d.fail(req.IdempotencyKey, "", fmt.Sprintf("speak_many accepts at most %d conversations", maxSpeakMany))
	}
	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = "queue"
	}
	if mode != "queue" && mode != "steer" {
		return d.fail(req.IdempotencyKey, "", "speak mode must be queue or steer")
	}
	if mode == "steer" && !req.Confirmed {
		return DispatchResult{
			Accepted:          false,
			Delivered:         false,
			TargetTitle:       req.Text,
			NeedsConfirmation: true,
		}
	}
	results := make([]DispatchResult, 0, len(ids))
	accepted := false
	for _, id := range ids {
		item := d.Speak(SpeakRequest{
			ConversationID: id,
			Text:           req.Text,
			IdempotencyKey: req.IdempotencyKey + ":" + id,
			Mode:           mode,
			Confirmed:      req.Confirmed || mode == "queue",
		})
		if item.Accepted && item.Delivered {
			accepted = true
		}
		results = append(results, item)
	}
	batch := SpeakManyResult{
		Accepted: accepted,
		Results:  results,
	}
	if !accepted {
		batch.Error = "no conversation received the instruction"
	}
	return batch
}

func uniqueIDs(ids []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func (d *Dispatcher) CreateConversation(req CreateRequest) DispatchResult {
	if result, ok := d.replay(req.IdempotencyKey); ok {
		return result
	}
	if !d.dispatchEnabled() {
		return d.fail(req.IdempotencyKey, "", "companion dispatch is turned off")
	}
	if d.catalog == nil {
		return d.fail(req.IdempotencyKey, "", "conversation catalog is not configured")
	}
	kind := normalizeConversationKind(req.Kind)
	title := req.Title
	if title == "" {
		title = kind
	}
	ref, err := d.catalog.Create(ConversationRef{
		Title:     title,
		Kind:      kind,
		Workspace: req.WorkspacePath,
	})
	if err != nil {
		return d.fail(req.IdempotencyKey, title, err.Error())
	}
	result := DispatchResult{
		Accepted:    true,
		Delivered:   true,
		TargetTitle: ref.Title,
		EntryID:     ref.ID,
	}
	if req.FirstMessage != "" && d.speaker != nil {
		entryID, produced, speakErr := d.speaker.DeliverSpeak(ref.ID, req.FirstMessage)
		if speakErr != nil || !produced {
			reason := "created conversation but first message was not delivered"
			if speakErr != nil {
				reason = speakErr.Error()
			}
			return d.recordFailure(req.IdempotencyKey, ref, ref.ID, reason)
		}
		result.EntryID = entryID
	}
	d.store(req.IdempotencyKey, result)
	return result
}

func (d *Dispatcher) Stop(req StopRequest) DispatchResult {
	if result, ok := d.replay(req.IdempotencyKey); ok {
		return result
	}
	if !d.dispatchEnabled() {
		return d.fail(req.IdempotencyKey, "", "companion dispatch is turned off")
	}
	if req.ConversationID == "" {
		return d.fail(req.IdempotencyKey, "", "stop requires conversationId")
	}
	if req.IdempotencyKey == "" {
		return d.fail(req.IdempotencyKey, "", "stop requires idempotencyKey")
	}
	ref, err := d.catalog.Lookup(req.ConversationID)
	if err != nil {
		return d.fail(req.IdempotencyKey, "", "conversation was not found")
	}
	if ref.Archived {
		return d.fail(req.IdempotencyKey, ref.Title, "conversation is archived")
	}
	if !req.Confirmed {
		return DispatchResult{
			Accepted:          false,
			Delivered:         false,
			TargetTitle:       ref.Title,
			NeedsConfirmation: true,
		}
	}
	d.mu.Lock()
	control := d.control
	d.mu.Unlock()
	if control == nil {
		return d.recordFailure(req.IdempotencyKey, ref, "", "session control is not configured")
	}
	if err := control.Abort(ref.ID); err != nil {
		return d.recordFailure(req.IdempotencyKey, ref, "", err.Error())
	}
	result := DispatchResult{
		Accepted:    true,
		Delivered:   true,
		TargetTitle: ref.Title,
	}
	d.store(req.IdempotencyKey, result)
	return result
}

func (d *Dispatcher) ReplaceDeliveries(results map[string]DispatchResult) {
	d.mu.Lock()
	defer d.mu.Unlock()
	next := make(map[string]DispatchResult, len(results))
	for key, result := range results {
		if strings.TrimSpace(key) == "" {
			continue
		}
		next[key] = result
	}
	d.deliveries = next
}

func (d *Dispatcher) Deliveries() map[string]DispatchResult {
	d.mu.Lock()
	defer d.mu.Unlock()
	next := make(map[string]DispatchResult, len(d.deliveries))
	for key, result := range d.deliveries {
		next[key] = result
	}
	return next
}

func (d *Dispatcher) dispatchEnabled() bool {
	return d.enabled == nil || d.enabled()
}

func (d *Dispatcher) replay(key string) (DispatchResult, bool) {
	key = strings.TrimSpace(key)
	if key == "" {
		return DispatchResult{}, false
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	result, ok := d.deliveries[key]
	if !ok {
		return DispatchResult{}, false
	}
	result.IdempotentReplay = true
	return result, true
}

func (d *Dispatcher) store(key string, result DispatchResult) {
	key = strings.TrimSpace(key)
	if key == "" {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.deliveries[key] = result
}

func (d *Dispatcher) fail(key, title, reason string) DispatchResult {
	result := DispatchResult{
		Accepted:    false,
		Delivered:   false,
		TargetTitle: title,
		Error:       reason,
	}
	d.store(key, result)
	return result
}

func (d *Dispatcher) recordFailure(key string, ref ConversationRef, entryID, reason string) DispatchResult {
	result := DispatchResult{
		Accepted:    true,
		Delivered:   false,
		TargetTitle: ref.Title,
		EntryID:     entryID,
		Error:       reason,
	}
	d.store(key, result)
	if d.board != nil {
		d.board.RecordDispatchFailure(ref.ID, reason)
	}
	return result
}

const (
	SpeakRouteSave     = "save"
	SpeakRouteSend     = "send"
	SpeakRouteQueue    = "queue"
	SpeakRouteFollowUp = "followup"
)

func SpeakRoute(registered, busy bool, kernel string) string {
	if !registered {
		return SpeakRouteSave
	}
	if !busy {
		return SpeakRouteSend
	}
	if strings.EqualFold(strings.TrimSpace(kernel), "dsh") {
		return SpeakRouteQueue
	}
	return SpeakRouteFollowUp
}

func normalizeConversationKind(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "ctf":
		return "ctf"
	case "cve":
		return "cve"
	case "lab":
		return "lab"
	default:
		return "coding"
	}
}

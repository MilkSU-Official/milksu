package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/codingattachment"
	"github.com/MilkSU-Official/milksu/internal/companion"
	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/engine"
)

type conversationCatalog struct {
	store *conversation.Store
}

func (c *conversationCatalog) Lookup(id string) (companion.ConversationRef, error) {
	if c == nil || c.store == nil {
		return companion.ConversationRef{}, fmt.Errorf("conversation store is not configured")
	}
	stored, err := c.store.Get(id)
	if err == nil {
		return conversationRef(stored, false), nil
	}
	archived, listErr := c.store.ListArchived()
	if listErr != nil {
		return companion.ConversationRef{}, err
	}
	for _, item := range archived {
		if item.ID == id {
			return conversationRef(item, true), nil
		}
	}
	return companion.ConversationRef{}, err
}

func (c *conversationCatalog) ListActive() ([]companion.ConversationRef, error) {
	if c == nil || c.store == nil {
		return nil, fmt.Errorf("conversation store is not configured")
	}
	stored, err := c.store.List()
	if err != nil {
		return nil, err
	}
	refs := make([]companion.ConversationRef, 0, len(stored))
	for _, item := range stored {
		refs = append(refs, conversationRef(item, false))
	}
	return refs, nil
}

func (c *conversationCatalog) ListArchived() ([]companion.ConversationRef, error) {
	if c == nil || c.store == nil {
		return nil, fmt.Errorf("conversation store is not configured")
	}
	stored, err := c.store.ListArchived()
	if err != nil {
		return nil, err
	}
	refs := make([]companion.ConversationRef, 0, len(stored))
	for _, item := range stored {
		refs = append(refs, conversationRef(item, true))
	}
	return refs, nil
}

func (c *conversationCatalog) Create(ref companion.ConversationRef) (companion.ConversationRef, error) {
	if c == nil || c.store == nil {
		return companion.ConversationRef{}, fmt.Errorf("conversation store is not configured")
	}
	id := strings.TrimSpace(ref.ID)
	if id == "" {
		id = "cmp_" + strings.ReplaceAll(fmt.Sprintf("%d", time.Now().UnixNano()), " ", "")
	}
	kind := strings.TrimSpace(ref.Kind)
	if kind == "" {
		kind = "coding"
	}
	stored := conversation.StoredConversation{
		ID:            id,
		Title:         firstNonEmpty(ref.Title, kind),
		CreatedAt:     uint64(time.Now().UnixMilli()),
		WorkspacePath: ref.Workspace,
		Kernel:        conversation.NormalizeKernel(ref.Kernel),
		Messages:      []conversation.StoredMessage{},
	}
	if kind != "coding" {
		stored.DomainTaskContext = map[string]any{"kind": kind}
	}
	if err := c.store.Save(stored); err != nil {
		return companion.ConversationRef{}, err
	}
	return conversationRef(stored, false), nil
}

func conversationRef(stored conversation.StoredConversation, archived bool) companion.ConversationRef {
	kind := "coding"
	if stored.DomainTaskContext != nil {
		if value, _ := stored.DomainTaskContext["kind"].(string); strings.TrimSpace(value) != "" {
			kind = value
		}
	}
	if stored.CTFJobID != "" {
		kind = "ctf"
	}
	return companion.ConversationRef{
		ID:        stored.ID,
		Title:     firstNonEmpty(stored.Title, stored.ID),
		Kind:      kind,
		Workspace: stored.WorkspacePath,
		Kernel:    stored.Kernel,
		Status:    "idle",
		Archived:  archived || stored.ArchivedAt > 0,
	}
}

type storeSpeaker struct {
	store   *conversation.Store
	engines *engine.Supervisor
}

type supervisorControl struct {
	engines *engine.Supervisor
}

func (s *supervisorControl) Abort(conversationID string) error {
	if s == nil || s.engines == nil {
		return fmt.Errorf("engine supervisor is not configured")
	}
	return s.engines.AbortMessage(conversationID)
}

func (s *supervisorControl) Steer(conversationID, text string) error {
	if s == nil || s.engines == nil {
		return fmt.Errorf("engine supervisor is not configured")
	}
	return s.engines.SteerMessage(conversationID, companion.RelayPrefix+text)
}

func (s *storeSpeaker) kernelOf(conversationID string) string {
	if s.store != nil {
		if stored, err := s.store.Get(conversationID); err == nil {
			return conversation.NormalizeKernel(stored.Kernel)
		}
	}
	if s.engines != nil {
		return s.engines.SessionKernel(conversationID)
	}
	return conversation.KernelPi
}

func (s *storeSpeaker) DeliverSpeak(conversationID, text string) (string, bool, error) {
	if s == nil || s.store == nil {
		return "", false, fmt.Errorf("conversation store is not configured")
	}
	prompt := companion.RelayPrefix + text
	registered := s.engines != nil && s.engines.HasRegisteredSession(conversationID)
	busy := s.engines != nil && s.engines.SessionBusy(conversationID)
	route := companion.SpeakRoute(registered, busy, s.kernelOf(conversationID))
	switch route {
	case companion.SpeakRouteSave:
		return s.appendRelay(conversationID, text)
	case companion.SpeakRouteSend:
		if err := s.engines.SendRegisteredMessage(conversationID, prompt); err != nil {
			return "", false, err
		}
		return s.ackID("send", conversationID), true, nil
	case companion.SpeakRouteQueue:
		if err := s.engines.QueueMessage(conversationID, prompt); err != nil {
			return "", false, err
		}
		return s.ackID("queue", conversationID), true, nil
	case companion.SpeakRouteFollowUp:
		if err := s.engines.FollowUpMessage(conversationID, prompt); err != nil {
			return "", false, err
		}
		return s.ackID("followup", conversationID), true, nil
	default:
		return "", false, fmt.Errorf("unsupported companion speak route")
	}
}

func (s *storeSpeaker) DeliverSteer(conversationID, text string) (string, bool, error) {
	if s == nil || s.store == nil {
		return "", false, fmt.Errorf("conversation store is not configured")
	}
	if s.engines == nil || !s.engines.HasRegisteredSession(conversationID) {
		return "", false, fmt.Errorf("target conversation is not running")
	}
	if err := s.engines.SteerMessage(conversationID, companion.RelayPrefix+text); err != nil {
		return "", false, err
	}
	return s.ackID("steer", conversationID), true, nil
}

func (s *storeSpeaker) ackID(route, conversationID string) string {
	return "cmp_ack_" + route + "_" + conversationID
}

func (s *storeSpeaker) appendRelay(conversationID, text string) (string, bool, error) {
	stored, err := s.store.Get(conversationID)
	if err != nil {
		return "", false, err
	}
	entryID := "cmp_entry_" + fmt.Sprintf("%d", time.Now().UnixNano())
	stored.Messages = append(stored.Messages, conversation.StoredMessage{
		ID:        entryID,
		Role:      "user",
		Content:   companion.RelayPrefix + text,
		Timestamp: uint64(time.Now().UnixMilli()),
	})
	if err := s.store.Save(stored); err != nil {
		return "", false, err
	}
	return entryID, true, nil
}

func (a *App) EnsureCompanion() (companion.Status, error) {
	if a == nil || a.companion == nil {
		return companion.Status{}, fmt.Errorf("companion runtime is not configured")
	}
	return a.companion.Ensure()
}

func (a *App) SendCompanionMessage(prompt string, attachments []codingattachment.Attachment) error {
	if a == nil || a.companion == nil {
		return fmt.Errorf("companion runtime is not configured")
	}
	return a.companion.Send(prompt, attachments)
}

func (a *App) GetCompanionStatus() companion.Status {
	if a == nil || a.companion == nil {
		return companion.Status{Error: "companion runtime is not configured"}
	}
	return a.companion.Status()
}

func (a *App) StopCompanion() error {
	if a == nil || a.companion == nil {
		return nil
	}
	return a.companion.Stop()
}

func (a *App) AbortCompanionTurn() error {
	if a == nil || a.companion == nil {
		return nil
	}
	return a.companion.AbortTurn()
}

func (a *App) GetCompanionBoard() companion.BoardSnapshot {
	if a == nil || a.companion == nil {
		return companion.BoardSnapshot{}
	}
	return a.companion.BoardSnapshot()
}

func (a *App) ListCompanionTranscript(limit int, cursor *companion.TranscriptCursor, before bool) (companion.TranscriptPage, error) {
	if a == nil || a.companion == nil {
		return companion.TranscriptPage{}, fmt.Errorf("companion runtime is not configured")
	}
	return a.companion.Transcript(limit, cursor, before)
}

func (a *App) ArchiveCompanionTranscript() (companion.CompanionArchive, error) {
	if a == nil || a.companion == nil {
		return companion.CompanionArchive{}, fmt.Errorf("companion runtime is not configured")
	}
	return a.companion.ArchiveTranscript()
}

func (a *App) ListCompanionArchives() ([]companion.CompanionArchive, error) {
	if a == nil || a.companion == nil {
		return []companion.CompanionArchive{}, nil
	}
	return a.companion.Archives()
}

func (a *App) DeleteCompanionArchive(name string) error {
	if a == nil || a.companion == nil {
		return fmt.Errorf("companion runtime is not configured")
	}
	return a.companion.DeleteArchive(name)
}

func (a *App) GetCompanionMemory() companion.MemorySnapshot {
	if a == nil || a.companion == nil {
		return companion.MemorySnapshot{}
	}
	return a.companion.MemorySnapshot()
}

func (a *App) ApproveCompanionMemory(id string) (companion.ApprovedMemory, error) {
	if a == nil || a.companion == nil {
		return companion.ApprovedMemory{}, fmt.Errorf("companion runtime is not configured")
	}
	return a.companion.ApproveMemory(id)
}

func (a *App) ForgetCompanionMemory(id string) error {
	if a == nil || a.companion == nil {
		return fmt.Errorf("companion runtime is not configured")
	}
	return a.companion.ForgetMemory(id)
}

func (a *App) ConfirmCompanionDispatch(action, conversationID, text, idempotencyKey, mode, hostRequestID string, accepted bool) (companion.DispatchResult, error) {
	if a == nil || a.companion == nil {
		return companion.DispatchResult{}, fmt.Errorf("companion runtime is not configured")
	}
	return a.companion.ConfirmDispatch(action, conversationID, text, idempotencyKey, mode, hostRequestID, accepted)
}

func (a *App) emitCompanionEvent(event engine.Event) {
	if a == nil || a.ctx == nil {
		return
	}
	event.Engine = companion.SessionID
	if event.SessionID == "" {
		event.SessionID = companion.SessionID
	}
	a.emitDesktopEvent("companion-event", event)
}

type companionAppControl struct {
	app *App
}

func (c *companionAppControl) OpenMainWindow() error {
	if c == nil || c.app == nil {
		return fmt.Errorf("desktop host is unavailable")
	}
	return c.app.desktopCall("window.show", map[string]any{}, nil)
}

func (c *companionAppControl) FocusConversation(id string) error {
	if _, err := c.lookup(id); err != nil {
		return err
	}
	if err := c.OpenMainWindow(); err != nil {
		return err
	}
	c.app.emitDesktopEvent("companion-focus", map[string]any{"conversationId": id})
	return nil
}

func (c *companionAppControl) ReadConversation(id string, limit int) (companion.ConversationExcerpt, error) {
	stored, err := c.lookup(id)
	if err != nil {
		return companion.ConversationExcerpt{}, err
	}
	roles := make([]string, len(stored.Messages))
	contents := make([]string, len(stored.Messages))
	for i, message := range stored.Messages {
		roles[i] = message.Role
		contents[i] = message.Content
	}
	return companion.ExcerptFromMessages(stored.ID, firstNonEmpty(stored.Title, stored.ID), roles, contents, limit), nil
}

func (c *companionAppControl) CurrentSettings() (config.AppSettings, error) {
	if c == nil || c.app == nil || c.app.settings == nil {
		return config.AppSettings{}, fmt.Errorf("settings are not configured")
	}
	return c.app.settings.Get(), nil
}

func (c *companionAppControl) SaveSettings(next config.AppSettings) error {
	if c == nil || c.app == nil {
		return fmt.Errorf("settings are not configured")
	}
	return c.app.SaveSettingsCmd(next)
}

func (c *companionAppControl) Quit() error {
	if c == nil || c.app == nil {
		return fmt.Errorf("desktop host is unavailable")
	}
	return c.app.desktopCall("app.quit", nil, nil)
}

func (c *companionAppControl) Relaunch() error {
	if c == nil || c.app == nil {
		return fmt.Errorf("desktop host is unavailable")
	}
	_, err := c.app.RelaunchDesktopApp()
	return err
}

func (c *companionAppControl) lookup(id string) (conversation.StoredConversation, error) {
	if c == nil || c.app == nil || c.app.conversations == nil {
		return conversation.StoredConversation{}, fmt.Errorf("conversation store is not configured")
	}
	stored, err := c.app.conversations.Get(id)
	if err == nil {
		if stored.ArchivedAt > 0 {
			return conversation.StoredConversation{}, fmt.Errorf("conversation is archived")
		}
		return stored, nil
	}
	archived, listErr := c.app.conversations.ListArchived()
	if listErr != nil {
		return conversation.StoredConversation{}, fmt.Errorf("conversation was not found")
	}
	for _, item := range archived {
		if item.ID == id {
			return conversation.StoredConversation{}, fmt.Errorf("conversation is archived")
		}
	}
	return conversation.StoredConversation{}, fmt.Errorf("conversation was not found")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

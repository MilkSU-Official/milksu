package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/companion"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/engine"
	"github.com/MilkSU-Official/milksu/internal/sessionindex"
)

type conversationIndexer struct {
	fts   *companion.FTSIndex
	store *conversation.Store
}

func (c *conversationIndexer) IndexEpisode(episode companion.Episode) {
	if c == nil {
		return
	}
	if c.store != nil && strings.TrimSpace(episode.SessionID) != "" {
		if stored, err := c.store.Get(episode.SessionID); err == nil {
			episode.Title = firstNonEmpty(episode.Title, stored.Title, stored.ID)
			if strings.TrimSpace(episode.Snippet) == "" && len(stored.Messages) > 0 {
				episode.Snippet = stored.Messages[len(stored.Messages)-1].Content
			}
		}
	}
	if c.fts != nil {
		c.fts.IndexEpisode(episode)
	}
}

func (c *conversationIndexer) Search(query string, limit int) ([]companion.MemoryHit, error) {
	if c == nil || c.fts == nil {
		return []companion.MemoryHit{}, nil
	}
	return c.fts.Search(query, limit)
}

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

func (s *storeSpeaker) DeliverSpeak(conversationID, text string) (string, bool, error) {
	if s == nil || s.store == nil {
		return "", false, fmt.Errorf("conversation store is not configured")
	}
	if s.engines != nil && s.engines.HasRegisteredSession(conversationID) {
		if err := s.engines.QueueMessage(conversationID, companion.RelayPrefix+text); err != nil {
			return "", false, err
		}
		return "cmp_queue_" + fmt.Sprintf("%d", time.Now().UnixNano()), true, nil
	}
	return s.appendRelay(conversationID, text)
}

func (s *storeSpeaker) DeliverSteer(conversationID, text string) (string, bool, error) {
	if s == nil || s.store == nil {
		return "", false, fmt.Errorf("conversation store is not configured")
	}
	if s.engines == nil || !s.engines.HasRegisteredSession(conversationID) {
		return "", false, fmt.Errorf("target conversation is not running")
	}
	entryID, produced, err := s.appendRelay(conversationID, text)
	if err != nil || !produced {
		return entryID, produced, err
	}
	if err := s.engines.SteerMessage(conversationID, companion.RelayPrefix+text); err != nil {
		return entryID, false, err
	}
	return entryID, true, nil
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

type sessionSearchAdapter struct {
	store *sessionindex.Store
}

func (a *sessionSearchAdapter) Search(query string, limit int, scope string) ([]companion.MemoryHit, error) {
	if a == nil || a.store == nil {
		return []companion.MemoryHit{}, nil
	}
	response, err := a.store.Search(context.Background(), sessionindex.SearchRequest{
		Query:  query,
		Limit:  limit,
		Source: scope,
	})
	if err != nil {
		return nil, err
	}
	hits := make([]companion.MemoryHit, 0, len(response.Results))
	for _, result := range response.Results {
		hits = append(hits, companion.MemoryHit{
			SessionID: result.SessionID,
			Snippet:   result.Snippet,
			Title:     result.SessionName,
		})
	}
	return hits, nil
}

func (a *App) EnsureCompanion() (companion.Status, error) {
	if a == nil || a.companion == nil {
		return companion.Status{}, fmt.Errorf("companion runtime is not configured")
	}
	return a.companion.Ensure()
}

func (a *App) SendCompanionMessage(prompt string) error {
	if a == nil || a.companion == nil {
		return fmt.Errorf("companion runtime is not configured")
	}
	return a.companion.Send(prompt)
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

func (a *App) ConfirmCompanionDispatch(action, conversationID, text, idempotencyKey, mode string) (companion.DispatchResult, error) {
	if a == nil || a.companion == nil {
		return companion.DispatchResult{}, fmt.Errorf("companion runtime is not configured")
	}
	return a.companion.ConfirmDispatch(action, conversationID, text, idempotencyKey, mode)
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

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

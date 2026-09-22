package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/google/uuid"
)

const recordDeletePreviewTTL = 10 * time.Minute
const recordDeleteMaxIDs = 50

type recordDeleteGrant struct {
	IDs      []string
	Archived bool
	Expires  time.Time
}

func conversationActivityAt(value conversation.StoredConversation) int64 {
	latest := int64(value.CreatedAt)
	for _, message := range value.Messages {
		stamp := int64(message.Timestamp)
		if stamp > latest {
			latest = stamp
		}
	}
	return latest
}

func conversationMatchesRecordFilter(value conversation.StoredConversation, request codingWorkspaceRequest) bool {
	if request.Unpinned && value.Pinned {
		return false
	}
	if path := strings.TrimSpace(request.WorkspacePath); path != "" {
		if filepath.Clean(value.WorkspacePath) != filepath.Clean(path) {
			return false
		}
	}
	if request.OlderThanDays > 0 {
		cutoff := time.Now().Add(-time.Duration(request.OlderThanDays) * 24 * time.Hour).UnixMilli()
		stamp := conversationActivityAt(value)
		if stamp <= 0 || stamp >= cutoff {
			return false
		}
	}
	return true
}

func (a *App) pinWorkspaceRecords(conversationID, kind string, request codingWorkspaceRequest) (string, error) {
	if kind != "conversation" {
		return "", fmt.Errorf("pin_records supports conversation records")
	}
	if request.Pinned == nil {
		return "", fmt.Errorf("pin_records requires pinned")
	}
	ids := recordIDs(request)
	if len(ids) == 0 {
		return "", fmt.Errorf("record ids are required")
	}
	if len(ids) > recordDeleteMaxIDs {
		return "", fmt.Errorf("pin_records accepts at most %d ids", recordDeleteMaxIDs)
	}
	pinned := *request.Pinned
	order := int64(0)
	if pinned {
		order = a.nextPinnedOrder()
	}
	records := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		saved, err := a.conversations.Get(id)
		if err != nil {
			return "", err
		}
		saved.Pinned = pinned
		if pinned {
			next := order
			saved.PinnedOrder = &next
			order++
		} else {
			saved.PinnedOrder = nil
		}
		if err := a.conversations.Save(saved); err != nil {
			return "", err
		}
		record := conversationRecord(saved, false)
		records = append(records, record)
	}
	a.emitWorkspaceRecordChanged("pin", "conversation", "", ids, nil, conversationID)
	a.notifyConversationsChanged()
	return encodeWorkspaceResult(map[string]any{
		"kind":    "conversation",
		"pinned":  pinned,
		"ids":     ids,
		"records": records,
	})
}

func (a *App) nextPinnedOrder() int64 {
	listed, err := a.conversations.List()
	if err != nil {
		return 0
	}
	var max int64 = -1
	for _, item := range listed {
		if !item.Pinned || item.PinnedOrder == nil {
			continue
		}
		if *item.PinnedOrder > max {
			max = *item.PinnedOrder
		}
	}
	return max + 1
}

func (a *App) deleteWorkspaceRecords(conversationID, kind string, request codingWorkspaceRequest) (string, error) {
	if kind != "conversation" {
		return "", fmt.Errorf("delete_records supports conversation records")
	}
	token := strings.TrimSpace(request.ConfirmationToken)
	if token != "" {
		return a.commitRecordDelete(conversationID, token)
	}
	ids := recordIDs(request)
	if len(ids) == 0 {
		return "", fmt.Errorf("record ids are required")
	}
	if len(ids) > recordDeleteMaxIDs {
		return "", fmt.Errorf("delete_records accepts at most %d ids", recordDeleteMaxIDs)
	}
	titles := make([]string, 0, len(ids))
	for _, id := range ids {
		saved, err := a.conversationForDelete(id, request.Archived)
		if err != nil {
			return "", err
		}
		title := strings.TrimSpace(saved.Title)
		if title == "" {
			title = id
		}
		titles = append(titles, title)
	}
	grantToken, err := newRecordDeleteToken()
	if err != nil {
		return "", err
	}
	a.recordDeleteMu.Lock()
	if a.recordDeletePreview == nil {
		a.recordDeletePreview = map[string]recordDeleteGrant{}
	}
	a.recordDeletePreview[grantToken] = recordDeleteGrant{
		IDs:      append([]string(nil), ids...),
		Archived: request.Archived,
		Expires:  time.Now().Add(recordDeletePreviewTTL),
	}
	a.recordDeleteMu.Unlock()
	summary := strings.Join(titles, "、")
	return encodeWorkspaceResult(map[string]any{
		"needsConfirmation": true,
		"kind":              "conversation",
		"ids":               ids,
		"titles":            titles,
		"summary":           summary,
		"confirmationToken": grantToken,
	})
}

func (a *App) commitRecordDelete(conversationID, token string) (string, error) {
	a.recordDeleteMu.Lock()
	grant, ok := a.recordDeletePreview[token]
	if ok {
		delete(a.recordDeletePreview, token)
	}
	a.recordDeleteMu.Unlock()
	if !ok || time.Now().After(grant.Expires) {
		return "", fmt.Errorf("delete confirmation is missing, expired, or already used")
	}
	for _, id := range grant.IDs {
		var err error
		if grant.Archived {
			err = a.deleteArchivedConversationRecord(id)
		} else {
			err = a.deleteActiveConversationRecord(id)
		}
		if err != nil {
			return "", err
		}
	}
	a.emitWorkspaceRecordChanged("delete", "conversation", "", grant.IDs, nil, conversationID)
	return encodeWorkspaceResult(map[string]any{
		"kind":    "conversation",
		"action":  "delete",
		"ids":     grant.IDs,
		"deleted": true,
	})
}

func (a *App) conversationForDelete(id string, archived bool) (conversation.StoredConversation, error) {
	listed, err := a.conversations.List()
	if archived {
		listed, err = a.conversations.ListArchived()
	}
	if err != nil {
		return conversation.StoredConversation{}, err
	}
	for _, item := range listed {
		if item.ID == id {
			return item, nil
		}
	}
	if archived {
		return conversation.StoredConversation{}, fmt.Errorf("archived conversation was not found")
	}
	return conversation.StoredConversation{}, fmt.Errorf("conversation was not found")
}

func (a *App) deleteActiveConversationRecord(id string) error {
	if a.engines != nil {
		return a.DeleteConversation(id)
	}
	if err := a.conversations.Delete(id); err != nil {
		return err
	}
	return a.refreshConversationIndex()
}

func (a *App) deleteArchivedConversationRecord(id string) error {
	if a.engines != nil {
		return a.DeleteArchivedConversation(id)
	}
	if err := a.conversations.DeleteArchived(id); err != nil {
		return err
	}
	return a.refreshConversationIndex()
}

func (a *App) forkWorkspaceRecord(conversationID, kind string, request codingWorkspaceRequest) (string, error) {
	if kind != "conversation" {
		return "", fmt.Errorf("fork_record supports conversation records")
	}
	id := strings.TrimSpace(request.ID)
	if id == "" {
		return "", fmt.Errorf("record id is required")
	}
	saved, err := a.conversations.Get(id)
	if err != nil {
		return "", err
	}
	forked := saved
	forked.ID = uuid.NewString()
	forked.CreatedAt = uint64(time.Now().UnixMilli())
	forked.Pinned = false
	forked.PinnedOrder = nil
	forked.ArchivedAt = 0
	forked.ParentConversationID = ""
	forked.Multitask = false
	forked.LastContextUsage = nil
	forked.AgentGoal = nil
	forked.Messages = []conversation.StoredMessage{}
	if saved.DomainTaskContext != nil {
		copied := make(map[string]any, len(saved.DomainTaskContext))
		for key, value := range saved.DomainTaskContext {
			copied[key] = value
		}
		forked.DomainTaskContext = copied
	}
	if err := a.conversations.Save(forked); err != nil {
		return "", err
	}
	record := conversationRecord(forked, false)
	a.emitWorkspaceRecordChanged("fork", "conversation", forked.ID, nil, record, conversationID)
	a.notifyConversationsChanged()
	return encodeWorkspaceResult(map[string]any{
		"record": record,
		"source": saved.ID,
	})
}

func newRecordDeleteToken() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

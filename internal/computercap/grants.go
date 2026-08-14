package computercap

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Grant struct {
	ConversationID string `json:"conversationId"`
	Target         Target `json:"target"`
	GrantedAt      string `json:"grantedAt"`
}

type grantStore struct {
	directory string
}

func newGrantStore(directory string) *grantStore {
	return &grantStore{directory: filepath.Clean(strings.TrimSpace(directory))}
}

func (store *grantStore) Load(conversationID string) (Grant, bool, error) {
	if store == nil || store.directory == "." || store.directory == "" {
		return Grant{}, false, nil
	}
	if !validConversationID(conversationID) {
		return Grant{}, false, fmt.Errorf("invalid Coding conversation id")
	}
	data, err := os.ReadFile(store.path(conversationID))
	if os.IsNotExist(err) {
		return Grant{}, false, nil
	}
	if err != nil {
		return Grant{}, false, fmt.Errorf("read Computer Use task authorization: %w", err)
	}
	var grant Grant
	if err := json.Unmarshal(data, &grant); err != nil {
		return Grant{}, true, fmt.Errorf("decode Computer Use task authorization: %w", err)
	}
	if grant.ConversationID != conversationID || !validGrantedTarget(grant.Target) {
		return Grant{}, true, fmt.Errorf("Computer Use task authorization is invalid")
	}
	return grant, true, nil
}

func (store *grantStore) Save(conversationID string, target Target) error {
	if store == nil || store.directory == "." || store.directory == "" {
		return nil
	}
	if !validConversationID(conversationID) {
		return fmt.Errorf("invalid Coding conversation id")
	}
	if !validGrantedTarget(target) {
		return fmt.Errorf("invalid Computer Use target authorization")
	}
	if err := os.MkdirAll(store.directory, 0o700); err != nil {
		return fmt.Errorf("create Computer Use authorization directory: %w", err)
	}
	if err := os.Chmod(store.directory, 0o700); err != nil {
		return fmt.Errorf("protect Computer Use authorization directory: %w", err)
	}
	data, err := json.MarshalIndent(Grant{
		ConversationID: conversationID,
		Target:         target,
		GrantedAt:      time.Now().UTC().Format(time.RFC3339Nano),
	}, "", "  ")
	if err != nil {
		return fmt.Errorf("encode Computer Use task authorization: %w", err)
	}
	temporary, err := os.CreateTemp(store.directory, conversationID+"-*.tmp")
	if err != nil {
		return fmt.Errorf("create Computer Use authorization update: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("protect Computer Use authorization update: %w", err)
	}
	if _, err := temporary.Write(data); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write Computer Use authorization update: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("sync Computer Use authorization update: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close Computer Use authorization update: %w", err)
	}
	if err := os.Rename(temporaryPath, store.path(conversationID)); err != nil {
		return fmt.Errorf("commit Computer Use task authorization: %w", err)
	}
	return os.Chmod(store.path(conversationID), 0o600)
}

func (store *grantStore) Delete(conversationID string) error {
	if store == nil || store.directory == "." || store.directory == "" {
		return nil
	}
	if !validConversationID(conversationID) {
		return fmt.Errorf("invalid Coding conversation id")
	}
	err := os.Remove(store.path(conversationID))
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("revoke Computer Use task authorization: %w", err)
	}
	return nil
}

func (store *grantStore) path(conversationID string) string {
	return filepath.Join(store.directory, conversationID+".json")
}

func validGrantedTarget(target Target) bool {
	return strings.TrimSpace(target.Name) != "" &&
		validBundleID(strings.TrimSpace(target.BundleID)) &&
		target.PID > 1 &&
		target.WindowID > 0
}

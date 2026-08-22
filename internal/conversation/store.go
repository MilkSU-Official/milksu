package conversation

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"time"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

var validID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

type StoredMessage struct {
	ID                string             `json:"id"`
	Role              string             `json:"role"`
	Content           string             `json:"content"`
	Timestamp         uint64             `json:"timestamp"`
	ToolName          *string            `json:"toolName,omitempty"`
	ToolCallID        *string            `json:"toolCallId,omitempty"`
	DurationMS        *int64             `json:"durationMs,omitempty"`
	Status            *string            `json:"status,omitempty"`
	ApprovalRequestID *string            `json:"approvalRequestId,omitempty"`
	ApprovalInput     *string            `json:"approvalInput,omitempty"`
	ApprovalState     *string            `json:"approvalState,omitempty"`
	ApprovalReason    *string            `json:"approvalReason,omitempty"`
	Attachments       []StoredAttachment `json:"attachments,omitempty"`
}

type StoredAttachment struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	MediaType string `json:"mediaType"`
	Size      int64  `json:"size"`
	SHA256    string `json:"sha256"`
}

type StoredCapability struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

type StoredGoal struct {
	ID                  string `json:"id"`
	Text                string `json:"text"`
	Status              string `json:"status"`
	StartedAt           int64  `json:"startedAt"`
	UpdatedAt           int64  `json:"updatedAt"`
	Iteration           int    `json:"iteration"`
	TokenBudget         *int64 `json:"tokenBudget,omitempty"`
	TokensUsed          int64  `json:"tokensUsed"`
	TimeUsedSeconds     int64  `json:"timeUsedSeconds"`
	AutomaticModelTurns int    `json:"automaticModelTurns"`
	QueuedCount         int    `json:"queuedCount"`
}

type StoredConversation struct {
	ID                string              `json:"id"`
	Title             string              `json:"title"`
	CreatedAt         uint64              `json:"createdAt"`
	WorkspacePath     string              `json:"workspacePath,omitempty"`
	ModelMode         string              `json:"modelMode,omitempty"`
	ModelProvider     string              `json:"modelProvider,omitempty"`
	ModelID           string              `json:"modelId,omitempty"`
	ExecutionMode     string              `json:"executionMode,omitempty"`
	ApprovalPolicy    string              `json:"approvalPolicy,omitempty"`
	MCPServers        []string            `json:"mcpServers,omitempty"`
	MCPConfigDigest   string              `json:"mcpConfigDigest,omitempty"`
	AgentTools        []string            `json:"agentTools,omitempty"`
	AgentExtensions   []string            `json:"agentExtensions,omitempty"`
	AgentSkills       []string            `json:"agentSkills,omitempty"`
	AgentCapabilities []StoredCapability  `json:"agentCapabilities,omitempty"`
	AgentGoal         *StoredGoal         `json:"agentGoal,omitempty"`
	CTFJobID          string              `json:"ctfJobId,omitempty"`
	CTFMode           string              `json:"ctfMode,omitempty"`
	CTFRole           string              `json:"ctfRole,omitempty"`
	DomainTaskContext map[string]any      `json:"domainTaskContext,omitempty"`
	LastContextUsage  *StoredContextUsage `json:"lastContextUsage,omitempty"`
	ArchivedAt        uint64              `json:"archivedAt,omitempty"`
	Messages          []StoredMessage     `json:"messages"`
}

type StoredContextUsage struct {
	InputTokens             int64  `json:"inputTokens"`
	OutputTokens            int64  `json:"outputTokens"`
	CacheReadTokens         int64  `json:"cacheReadTokens"`
	CacheWriteTokens        int64  `json:"cacheWriteTokens"`
	ReasoningTokens         int64  `json:"reasoningTokens,omitempty"`
	TotalTokens             int64  `json:"totalTokens"`
	ContextWindow           int64  `json:"contextWindow,omitempty"`
	Model                   string `json:"model,omitempty"`
	Provider                string `json:"provider,omitempty"`
	RecordedAt              int64  `json:"recordedAt"`
	SessionInputTokens      int64  `json:"sessionInputTokens,omitempty"`
	SessionOutputTokens     int64  `json:"sessionOutputTokens,omitempty"`
	SessionCacheReadTokens  int64  `json:"sessionCacheReadTokens,omitempty"`
	SessionCacheWriteTokens int64  `json:"sessionCacheWriteTokens,omitempty"`
	SessionReasoningTokens  int64  `json:"sessionReasoningTokens,omitempty"`
	SessionTotalTokens      int64  `json:"sessionTotalTokens,omitempty"`
	SessionTurns            int64  `json:"sessionTurns,omitempty"`
}

type Store struct {
	directory string
}

func NewStore() (*Store, error) {
	base, err := appdata.Directory()
	if err != nil {
		return nil, err
	}
	directory := filepath.Join(base, "conversations")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create conversation directory: %w", err)
	}
	if err := os.MkdirAll(filepath.Join(directory, "archived"), 0o700); err != nil {
		return nil, fmt.Errorf("create archived conversation directory: %w", err)
	}
	return &Store{directory: directory}, nil
}

func (s *Store) List() ([]StoredConversation, error) {
	return s.listDirectory(s.directory)
}

func (s *Store) ListArchived() ([]StoredConversation, error) {
	values, err := s.listDirectory(s.archivedDirectory())
	if err != nil {
		return nil, err
	}
	sort.Slice(values, func(i, j int) bool {
		return values[i].ArchivedAt > values[j].ArchivedAt
	})
	return values, nil
}

func (s *Store) listDirectory(directory string) ([]StoredConversation, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, fmt.Errorf("list conversations: %w", err)
	}

	values := make([]StoredConversation, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(directory, entry.Name()))
		if err != nil {
			continue
		}
		var value StoredConversation
		if json.Unmarshal(data, &value) == nil {
			values = append(values, value)
		}
	}
	sort.Slice(values, func(i, j int) bool {
		return values[i].CreatedAt > values[j].CreatedAt
	})
	return values, nil
}

func (s *Store) archivedDirectory() string {
	return filepath.Join(s.directory, "archived")
}

func (s *Store) Get(id string) (StoredConversation, error) {
	if !validID.MatchString(id) {
		return StoredConversation{}, fmt.Errorf("invalid conversation id")
	}
	data, err := os.ReadFile(filepath.Join(s.directory, id+".json"))
	if err != nil {
		return StoredConversation{}, fmt.Errorf("read conversation: %w", err)
	}
	var value StoredConversation
	if err := json.Unmarshal(data, &value); err != nil {
		return StoredConversation{}, fmt.Errorf("decode conversation: %w", err)
	}
	if value.ID != id {
		return StoredConversation{}, fmt.Errorf("conversation id does not match stored record")
	}
	return value, nil
}

func (s *Store) Save(value StoredConversation) error {
	if !validID.MatchString(value.ID) {
		return fmt.Errorf("invalid conversation id")
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("encode conversation: %w", err)
	}
	path := filepath.Join(s.directory, value.ID+".json")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("write conversation: %w", err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return fmt.Errorf("tighten conversation permissions: %w", err)
	}
	return nil
}

func (s *Store) Delete(id string) error {
	return s.deleteFromDirectory(s.directory, id)
}

// Archive and Restore move the record with a single rename so a conversation is
// never listed in both places: the stamp is rewritten only after the move lands.
func (s *Store) Archive(id string) error {
	if err := s.move(s.directory, s.archivedDirectory(), id); err != nil {
		return err
	}
	return s.stamp(s.archivedDirectory(), id, uint64(time.Now().UnixMilli()))
}

func (s *Store) Restore(id string) error {
	if err := s.move(s.archivedDirectory(), s.directory, id); err != nil {
		return err
	}
	return s.stamp(s.directory, id, 0)
}

func (s *Store) move(from, to, id string) error {
	if !validID.MatchString(id) {
		return fmt.Errorf("invalid conversation id")
	}
	if err := os.MkdirAll(to, 0o700); err != nil {
		return fmt.Errorf("create conversation directory: %w", err)
	}
	if err := os.Rename(filepath.Join(from, id+".json"), filepath.Join(to, id+".json")); err != nil {
		return fmt.Errorf("move conversation: %w", err)
	}
	return nil
}

func (s *Store) stamp(directory, id string, archivedAt uint64) error {
	value, err := s.getFromDirectory(directory, id)
	if err != nil {
		return err
	}
	value.ArchivedAt = archivedAt
	return s.writeToDirectory(directory, value)
}

func (s *Store) DeleteArchived(id string) error {
	return s.deleteFromDirectory(s.archivedDirectory(), id)
}

func (s *Store) getFromDirectory(directory, id string) (StoredConversation, error) {
	if !validID.MatchString(id) {
		return StoredConversation{}, fmt.Errorf("invalid conversation id")
	}
	data, err := os.ReadFile(filepath.Join(directory, id+".json"))
	if err != nil {
		return StoredConversation{}, fmt.Errorf("read conversation: %w", err)
	}
	var value StoredConversation
	if err := json.Unmarshal(data, &value); err != nil {
		return StoredConversation{}, fmt.Errorf("decode conversation: %w", err)
	}
	if value.ID != id {
		return StoredConversation{}, fmt.Errorf("conversation id does not match stored record")
	}
	return value, nil
}

func (s *Store) writeToDirectory(directory string, value StoredConversation) error {
	if !validID.MatchString(value.ID) {
		return fmt.Errorf("invalid conversation id")
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create conversation directory: %w", err)
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("encode conversation: %w", err)
	}
	path := filepath.Join(directory, value.ID+".json")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("write conversation: %w", err)
	}
	return os.Chmod(path, 0o600)
}

func (s *Store) deleteFromDirectory(directory, id string) error {
	if !validID.MatchString(id) {
		return fmt.Errorf("invalid conversation id")
	}
	err := os.Remove(filepath.Join(directory, id+".json"))
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("delete conversation: %w", err)
	}
	return nil
}

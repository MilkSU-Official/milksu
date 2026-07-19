package conversation

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

var validID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

type StoredMessage struct {
	ID        string  `json:"id"`
	Role      string  `json:"role"`
	Content   string  `json:"content"`
	Timestamp uint64  `json:"timestamp"`
	ToolName  *string `json:"toolName,omitempty"`
	Status    *string `json:"status,omitempty"`
}

type StoredConversation struct {
	ID        string          `json:"id"`
	Title     string          `json:"title"`
	CreatedAt uint64          `json:"createdAt"`
	Messages  []StoredMessage `json:"messages"`
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
	return &Store{directory: directory}, nil
}

func (s *Store) List() ([]StoredConversation, error) {
	entries, err := os.ReadDir(s.directory)
	if err != nil {
		return nil, fmt.Errorf("list conversations: %w", err)
	}

	values := make([]StoredConversation, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(s.directory, entry.Name()))
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
	if !validID.MatchString(id) {
		return fmt.Errorf("invalid conversation id")
	}
	err := os.Remove(filepath.Join(s.directory, id+".json"))
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("delete conversation: %w", err)
	}
	return nil
}

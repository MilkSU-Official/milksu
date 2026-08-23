package lab

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

var validID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

type Job struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Scope      string `json:"scope"`
	Request    string `json:"request"`
	CreatedAt  int64  `json:"createdAt"`
	UpdatedAt  int64  `json:"updatedAt"`
	ArchivedAt uint64 `json:"archivedAt,omitempty"`
}

type Store struct {
	directory string
}

func NewStore() (*Store, error) {
	base, err := appdata.Directory()
	if err != nil {
		return nil, err
	}
	directory := filepath.Join(base, "lab-jobs")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create lab job directory: %w", err)
	}
	if err := os.MkdirAll(filepath.Join(directory, "archived"), 0o700); err != nil {
		return nil, fmt.Errorf("create archived lab job directory: %w", err)
	}
	return &Store{directory: directory}, nil
}

func NewStoreAt(directory string) (*Store, error) {
	if strings.TrimSpace(directory) == "" {
		return nil, fmt.Errorf("lab job directory is required")
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create lab job directory: %w", err)
	}
	if err := os.MkdirAll(filepath.Join(directory, "archived"), 0o700); err != nil {
		return nil, fmt.Errorf("create archived lab job directory: %w", err)
	}
	return &Store{directory: directory}, nil
}

func (s *Store) List() ([]Job, error) {
	return s.listDirectory(s.directory)
}

func (s *Store) ListArchived() ([]Job, error) {
	values, err := s.listDirectory(s.archivedDirectory())
	if err != nil {
		return nil, err
	}
	sort.Slice(values, func(i, j int) bool {
		return values[i].ArchivedAt > values[j].ArchivedAt
	})
	return values, nil
}

func (s *Store) Get(id string) (Job, error) {
	return s.getFromDirectory(s.directory, id)
}

func (s *Store) Save(value Job) error {
	normalized, err := normalizeJob(value)
	if err != nil {
		return err
	}
	return s.writeToDirectory(s.directory, normalized)
}

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

func (s *Store) listDirectory(directory string) ([]Job, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, fmt.Errorf("list lab jobs: %w", err)
	}
	values := make([]Job, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(directory, entry.Name()))
		if err != nil {
			continue
		}
		var value Job
		if json.Unmarshal(data, &value) != nil {
			continue
		}
		normalized, err := normalizeJob(value)
		if err != nil {
			continue
		}
		values = append(values, normalized)
	}
	sort.Slice(values, func(i, j int) bool {
		if values[i].UpdatedAt == values[j].UpdatedAt {
			return values[i].CreatedAt > values[j].CreatedAt
		}
		return values[i].UpdatedAt > values[j].UpdatedAt
	})
	return values, nil
}

func (s *Store) archivedDirectory() string {
	return filepath.Join(s.directory, "archived")
}

func (s *Store) getFromDirectory(directory, id string) (Job, error) {
	if !validID.MatchString(id) {
		return Job{}, fmt.Errorf("invalid lab job id")
	}
	data, err := os.ReadFile(filepath.Join(directory, id+".json"))
	if err != nil {
		return Job{}, fmt.Errorf("read lab job: %w", err)
	}
	var value Job
	if err := json.Unmarshal(data, &value); err != nil {
		return Job{}, fmt.Errorf("decode lab job: %w", err)
	}
	normalized, err := normalizeJob(value)
	if err != nil {
		return Job{}, err
	}
	if normalized.ID != id {
		return Job{}, fmt.Errorf("lab job id does not match stored record")
	}
	return normalized, nil
}

func (s *Store) writeToDirectory(directory string, value Job) error {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create lab job directory: %w", err)
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("encode lab job: %w", err)
	}
	path := filepath.Join(directory, value.ID+".json")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("write lab job: %w", err)
	}
	return os.Chmod(path, 0o600)
}

func (s *Store) move(from, to, id string) error {
	if !validID.MatchString(id) {
		return fmt.Errorf("invalid lab job id")
	}
	if err := os.MkdirAll(to, 0o700); err != nil {
		return fmt.Errorf("create lab job directory: %w", err)
	}
	if err := os.Rename(filepath.Join(from, id+".json"), filepath.Join(to, id+".json")); err != nil {
		return fmt.Errorf("move lab job: %w", err)
	}
	return nil
}

func (s *Store) stamp(directory, id string, archivedAt uint64) error {
	value, err := s.getFromDirectory(directory, id)
	if err != nil {
		return err
	}
	value.ArchivedAt = archivedAt
	value.UpdatedAt = time.Now().UnixMilli()
	return s.writeToDirectory(directory, value)
}

func normalizeJob(value Job) (Job, error) {
	id := strings.TrimSpace(value.ID)
	if !validID.MatchString(id) {
		return Job{}, fmt.Errorf("invalid lab job id")
	}
	title := clipTitle(value.Title)
	request := strings.TrimSpace(value.Request)
	if title == "" {
		title = clipTitle(request)
	}
	if title == "" {
		title = "实验室作业"
	}
	scope := strings.TrimSpace(value.Scope)
	if scope != "local" {
		scope = "remote"
	}
	createdAt := value.CreatedAt
	if createdAt <= 0 {
		createdAt = time.Now().UnixMilli()
	}
	updatedAt := value.UpdatedAt
	if updatedAt <= 0 {
		updatedAt = createdAt
	}
	return Job{
		ID:         id,
		Title:      title,
		Scope:      scope,
		Request:    request,
		CreatedAt:  createdAt,
		UpdatedAt:  updatedAt,
		ArchivedAt: value.ArchivedAt,
	}, nil
}

func clipTitle(value string) string {
	line := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	runes := []rune(line)
	if len(runes) <= 40 {
		return line
	}
	return string(runes[:40])
}

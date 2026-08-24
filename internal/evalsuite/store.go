package evalsuite

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

type persistedBoard struct {
	Schema    string                            `json:"schema"`
	Scores    map[string]map[string]ScoreRecord `json:"scores"`
	Durations map[string]int64                  `json:"durations,omitempty"`
}

type Store struct {
	path string
}

func NewStore() (*Store, error) {
	base, err := appdata.Directory()
	if err != nil {
		return nil, err
	}
	directory := filepath.Join(base, "evalsuite")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create evalsuite directory: %w", err)
	}
	return &Store{path: filepath.Join(directory, "board.json")}, nil
}

func NewStoreAt(path string) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("evalsuite store path is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create evalsuite directory: %w", err)
	}
	return &Store{path: path}, nil
}

func (s *Store) Load() (persistedBoard, error) {
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return persistedBoard{
				Schema:    "milksu.evalsuite/v1",
				Scores:    map[string]map[string]ScoreRecord{},
				Durations: map[string]int64{},
			}, nil
		}
		return persistedBoard{}, fmt.Errorf("read eval board: %w", err)
	}
	var value persistedBoard
	if err := json.Unmarshal(data, &value); err != nil {
		return persistedBoard{}, fmt.Errorf("decode eval board: %w", err)
	}
	if value.Scores == nil {
		value.Scores = map[string]map[string]ScoreRecord{}
	}
	if value.Durations == nil {
		value.Durations = map[string]int64{}
	}
	value.Schema = "milksu.evalsuite/v1"
	return value, nil
}

func (s *Store) Save(value persistedBoard) error {
	value.Schema = "milksu.evalsuite/v1"
	if value.Scores == nil {
		value.Scores = map[string]map[string]ScoreRecord{}
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("encode eval board: %w", err)
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("write eval board: %w", err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		return fmt.Errorf("replace eval board: %w", err)
	}
	return nil
}

func (s *Store) PutScore(suite string, record ScoreRecord) error {
	board, err := s.Load()
	if err != nil {
		return err
	}
	if board.Scores[suite] == nil {
		board.Scores[suite] = map[string]ScoreRecord{}
	}
	board.Scores[suite][record.Model.Key()] = record
	return s.Save(board)
}

func (s *Store) PutDuration(suite string, millis int64) error {
	if millis <= 0 {
		return nil
	}
	board, err := s.Load()
	if err != nil {
		return err
	}
	board.Durations[suite] = millis
	return s.Save(board)
}

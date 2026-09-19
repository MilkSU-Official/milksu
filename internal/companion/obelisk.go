package companion

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	_ "modernc.org/sqlite"
)

type Episode struct {
	SessionID string
	Title     string
	Snippet   string
	Kernel    string
}

type EpisodeIndexer interface {
	IndexEpisode(episode Episode)
	Search(query string, limit int) ([]MemoryHit, error)
}

type FTSIndex struct {
	mu   sync.Mutex
	path string
	db   *sql.DB
}

func NewFTSIndex(path string) (*FTSIndex, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("companion index path is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`
PRAGMA journal_mode=WAL;
CREATE VIRTUAL TABLE IF NOT EXISTS episodes USING fts5(
  session_id UNINDEXED,
  title,
  snippet,
  kernel UNINDEXED,
  tokenize='unicode61'
);
`); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &FTSIndex{path: path, db: db}, nil
}

func (i *FTSIndex) Close() error {
	if i == nil || i.db == nil {
		return nil
	}
	return i.db.Close()
}

func (i *FTSIndex) IndexEpisode(episode Episode) {
	if i == nil || i.db == nil {
		return
	}
	sessionID := strings.TrimSpace(episode.SessionID)
	snippet := strings.TrimSpace(episode.Snippet)
	if sessionID == "" || snippet == "" {
		return
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	_, _ = i.db.Exec(
		`INSERT INTO episodes(session_id, title, snippet, kernel) VALUES (?, ?, ?, ?)`,
		sessionID,
		strings.TrimSpace(episode.Title),
		snippet,
		strings.TrimSpace(episode.Kernel),
	)
}

func (i *FTSIndex) Search(query string, limit int) ([]MemoryHit, error) {
	query = strings.TrimSpace(query)
	if query == "" || i == nil || i.db == nil {
		return []MemoryHit{}, nil
	}
	if limit <= 0 {
		limit = 8
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	rows, err := i.db.Query(
		`SELECT session_id, title, snippet FROM episodes WHERE episodes MATCH ? LIMIT ?`,
		query,
		limit,
	)
	if err != nil {
		return []MemoryHit{}, err
	}
	defer rows.Close()
	hits := make([]MemoryHit, 0, limit)
	for rows.Next() {
		var hit MemoryHit
		if err := rows.Scan(&hit.SessionID, &hit.Title, &hit.Snippet); err != nil {
			return hits, err
		}
		hits = append(hits, hit)
	}
	return hits, rows.Err()
}

type compositeSearcher struct {
	primary SessionSearcher
	fts     EpisodeIndexer
}

func CompositeSearcher(primary SessionSearcher, fts EpisodeIndexer) SessionSearcher {
	return &compositeSearcher{primary: primary, fts: fts}
}

func (s *compositeSearcher) Search(query string, limit int, scope string) ([]MemoryHit, error) {
	var hits []MemoryHit
	if s.fts != nil {
		local, err := s.fts.Search(query, limit)
		if err == nil {
			hits = append(hits, local...)
		}
	}
	if s.primary != nil {
		remote, err := s.primary.Search(query, limit, scope)
		if err != nil && len(hits) == 0 {
			return nil, err
		}
		hits = append(hits, remote...)
	}
	if limit > 0 && len(hits) > limit {
		hits = hits[:limit]
	}
	if hits == nil {
		hits = []MemoryHit{}
	}
	return hits, nil
}

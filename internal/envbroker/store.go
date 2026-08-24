package envbroker

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Store struct {
	mu     sync.Mutex
	path   string
	leases map[string]Lease
}

func NewStore(dataDirectory string) (*Store, error) {
	directory := filepath.Join(dataDirectory, "envbroker")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create envbroker directory: %w", err)
	}
	store := &Store{
		path:   filepath.Join(directory, "leases.json"),
		leases: map[string]Lease{},
	}
	_ = store.load()
	return store, nil
}

func (s *Store) Get(owner Owner) (Lease, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	lease, ok := s.leases[owner.Key()]
	return lease, ok
}

func (s *Store) Put(lease Lease) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.leases == nil {
		s.leases = map[string]Lease{}
	}
	lease.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	s.leases[Owner{Kind: lease.OwnerKind, ID: lease.OwnerID}.Key()] = lease
	return s.persistLocked()
}

func (s *Store) Occupant(packageID, address string, except Owner) (Lease, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, lease := range s.leases {
		if key == except.Key() {
			continue
		}
		if lease.State != "ready" && lease.State != "pulling" {
			continue
		}
		if packageID != "" && lease.PackageID == packageID {
			return lease, true
		}
		if address != "" && lease.Address == address {
			return lease, true
		}
	}
	return Lease{}, false
}

func (s *Store) load() error {
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var parsed map[string]Lease
	if err := json.Unmarshal(data, &parsed); err != nil {
		return err
	}
	s.leases = parsed
	return nil
}

func (s *Store) persistLocked() error {
	data, err := json.MarshalIndent(s.leases, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, s.path); err == nil {
		return nil
	}
	_ = os.Remove(s.path)
	return os.Rename(tmp, s.path)
}

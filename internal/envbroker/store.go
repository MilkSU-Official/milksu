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

func (s *Store) All() []Lease {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Lease, 0, len(s.leases))
	for _, lease := range s.leases {
		out = append(out, lease)
	}
	return out
}

func leaseHoldsResource(lease Lease) bool {
	switch lease.State {
	case "ready", "pulling", "failed":
		return true
	default:
		return false
	}
}

func (s *Store) Occupant(item Package, except Owner) (Lease, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, lease := range s.leases {
		if key == except.Key() || !leaseHoldsResource(lease) {
			continue
		}
		if item.Provider == "docker" {
			if item.ID != "" && lease.PackageID == item.ID {
				return lease, true
			}
			if item.Address != "" && lease.Address == item.Address {
				return lease, true
			}
			continue
		}
		if item.Provider == "android-avd" && lease.Provider == "android-avd" {
			continue
		}
	}
	return Lease{}, false
}

func (s *Store) HeldAndroid(except Owner) (devices map[string]bool, serials map[string]bool, holder Lease) {
	s.mu.Lock()
	defer s.mu.Unlock()
	devices = map[string]bool{}
	serials = map[string]bool{}
	for key, lease := range s.leases {
		if key == except.Key() || lease.Provider != "android-avd" || !leaseHoldsResource(lease) {
			continue
		}
		if lease.Device != "" {
			devices[lease.Device] = true
		}
		if lease.Address != "" {
			serials[lease.Address] = true
		}
		if holder.OwnerID == "" {
			holder = lease
		}
	}
	return devices, serials, holder
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

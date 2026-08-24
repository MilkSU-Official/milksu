package envbroker

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Service struct {
	dataDirectory string
	store         *Store
	compose       composeRunner
	android       androidRunner
	waitReady     func(context.Context, string)
	mu            sync.Mutex
	inflight      map[string]context.CancelFunc
}

func New(dataDirectory string) (*Service, error) {
	store, err := NewStore(dataDirectory)
	if err != nil {
		return nil, err
	}
	return &Service{
		dataDirectory: dataDirectory,
		store:         store,
		compose:       execComposeRunner{},
		android:       execAndroidRunner{},
		waitReady:     waitHTTPReady,
		inflight:      map[string]context.CancelFunc{},
	}, nil
}

func NewForTest(dataDirectory string, compose composeRunner, android androidRunner) (*Service, error) {
	service, err := New(dataDirectory)
	if err != nil {
		return nil, err
	}
	service.waitReady = nil
	if compose != nil {
		service.compose = compose
	}
	if android != nil {
		service.android = android
	}
	return service, nil
}

func (s *Service) Catalog() []Package {
	return Catalog()
}

func (s *Service) PackageForCVE(cveID string) (Package, bool) {
	return PackageForCVE(cveID)
}

func (s *Service) Get(owner Owner) Lease {
	if lease, ok := s.store.Get(owner); ok {
		return lease
	}
	return emptyLease(owner)
}

func (s *Service) Start(ctx context.Context, owner Owner, packageID string) (Lease, error) {
	item, ok := PackageByID(packageID)
	if !ok {
		lease := emptyLease(owner)
		lease.State = "failed"
		lease.Error = "未知练习包"
		_ = s.store.Put(lease)
		return lease, nil
	}
	if occupant, busy := s.store.Occupant(item.ID, item.Address, owner); busy {
		lease := emptyLease(owner)
		lease.State = "busy"
		lease.PackageID = item.ID
		lease.PackageName = item.Name
		lease.Provider = item.Provider
		lease.Surface = item.Surface
		lease.Address = item.Address
		lease.OccupyOwner = occupant.OwnerKind + ":" + occupant.OwnerID
		lease.Error = "被作业 " + lease.OccupyOwner + " 占用"
		_ = s.store.Put(lease)
		return lease, nil
	}
	lease := Lease{
		Schema:      LeaseSchema,
		OwnerKind:   owner.Kind,
		OwnerID:     owner.ID,
		PackageID:   item.ID,
		PackageName: item.Name,
		Provider:    item.Provider,
		Surface:     item.Surface,
		State:       "pulling",
		Address:     item.Address,
		Detail:      item.Detail,
	}
	if item.Provider == "docker" {
		if err := dockerAvailable(s.compose); err != nil {
			lease.State = "docker-down"
			lease.Error = err.Error()
			lease.DockerAvailable = false
			_ = s.store.Put(lease)
			return lease, nil
		}
		lease.DockerAvailable = true
		directory, err := materializeCompose(s.dataDirectory, owner, item)
		if err != nil {
			lease.State = "failed"
			lease.Error = err.Error()
			_ = s.store.Put(lease)
			return lease, nil
		}
		if state, _ := composeStatus(ctx, s.compose, directory, projectName(item)); state == "ready" {
			lease.State = "ready"
			lease.Error = ""
			_ = s.store.Put(lease)
			return lease, nil
		}
		_ = s.store.Put(lease)
		s.spawn(owner, func(run context.Context) {
			s.runDockerStart(run, item, directory, lease)
		})
		return lease, nil
	}
	if item.Provider == "android-avd" {
		if serial, state, _ := androidStatus(ctx, s.android); state == "ready" && serial != "" {
			lease.Address = serial
			lease.State = "ready"
			lease.Error = ""
			_ = s.store.Put(lease)
			return lease, nil
		}
		_ = s.store.Put(lease)
		s.spawn(owner, func(run context.Context) {
			s.runAndroidStart(run, lease)
		})
		return lease, nil
	}
	lease.State = "failed"
	lease.Error = "不支持的 Provider"
	_ = s.store.Put(lease)
	return lease, nil
}

func (s *Service) runDockerStart(ctx context.Context, item Package, directory string, lease Lease) {
	if err := startCompose(ctx, s.compose, directory, projectName(item)); err != nil {
		lease.State = "failed"
		lease.Error = err.Error()
		_ = s.store.Put(lease)
		return
	}
	if s.waitReady != nil && item.Address != "" {
		s.waitReady(ctx, item.Address)
	}
	if ctx.Err() != nil {
		return
	}
	lease.State = "ready"
	lease.Error = ""
	_ = s.store.Put(lease)
}

func (s *Service) runAndroidStart(ctx context.Context, lease Lease) {
	serial, err := startAndroid(ctx, s.android)
	if err != nil {
		lease.State = "failed"
		lease.Error = err.Error()
		_ = s.store.Put(lease)
		return
	}
	if ctx.Err() != nil {
		return
	}
	lease.Address = serial
	lease.State = "ready"
	lease.Error = ""
	_ = s.store.Put(lease)
}

func (s *Service) spawn(owner Owner, run func(context.Context)) {
	s.mu.Lock()
	if cancel, ok := s.inflight[owner.Key()]; ok {
		cancel()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	s.inflight[owner.Key()] = cancel
	s.mu.Unlock()
	go func() {
		defer func() {
			s.mu.Lock()
			delete(s.inflight, owner.Key())
			s.mu.Unlock()
			cancel()
		}()
		run(ctx)
	}()
}

func (s *Service) cancelInflight(owner Owner) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if cancel, ok := s.inflight[owner.Key()]; ok {
		cancel()
		delete(s.inflight, owner.Key())
	}
}

func (s *Service) Status(ctx context.Context, owner Owner) Lease {
	lease := s.Get(owner)
	if lease.PackageID == "" {
		return lease
	}
	item, ok := PackageByID(lease.PackageID)
	if !ok {
		return lease
	}
	if lease.State == "pulling" || lease.State == "failed" || lease.State == "docker-down" || lease.State == "busy" {
		return lease
	}
	if item.Provider == "docker" {
		if err := dockerAvailable(s.compose); err != nil {
			lease.State = "docker-down"
			lease.Error = err.Error()
			lease.DockerAvailable = false
			_ = s.store.Put(lease)
			return lease
		}
		lease.DockerAvailable = true
		directory := instanceDirectory(s.dataDirectory, owner, item.ID)
		state, err := composeStatus(ctx, s.compose, directory, projectName(item))
		if err != nil {
			lease.Detail = err.Error()
		}
		if state == "ready" || state == "stopped" {
			lease.State = state
			if state == "ready" {
				lease.Error = ""
			}
		}
		_ = s.store.Put(lease)
		return lease
	}
	if item.Provider == "android-avd" {
		serial, state, err := androidStatus(ctx, s.android)
		if err != nil && state != "ready" {
			lease.Error = err.Error()
		}
		if serial != "" {
			lease.Address = serial
		}
		lease.State = state
		_ = s.store.Put(lease)
		return lease
	}
	return lease
}

func (s *Service) Stop(ctx context.Context, owner Owner) (Lease, error) {
	s.cancelInflight(owner)
	lease := s.Get(owner)
	if lease.PackageID == "" {
		return lease, nil
	}
	item, ok := PackageByID(lease.PackageID)
	if !ok {
		lease.State = "stopped"
		_ = s.store.Put(lease)
		return lease, nil
	}
	if item.Provider == "docker" {
		directory := instanceDirectory(s.dataDirectory, owner, item.ID)
		if err := stopCompose(ctx, s.compose, directory, projectName(item)); err != nil {
			lease.State = "failed"
			lease.Error = err.Error()
			_ = s.store.Put(lease)
			return lease, nil
		}
	}
	if item.Provider == "android-avd" {
		_ = stopAndroid(ctx, s.android, lease.Address)
	}
	lease.State = "stopped"
	lease.Error = ""
	_ = s.store.Put(lease)
	return lease, nil
}

func (s *Service) Reset(ctx context.Context, owner Owner) (Lease, error) {
	if _, err := s.Stop(ctx, owner); err != nil {
		return s.Get(owner), err
	}
	lease := s.Get(owner)
	if lease.PackageID == "" {
		return lease, nil
	}
	return s.Start(ctx, owner, lease.PackageID)
}

func (s *Service) Probe(ctx context.Context, owner Owner) (string, error) {
	lease := s.Status(ctx, owner)
	if lease.State != "ready" || lease.Address == "" {
		return "", fmt.Errorf("环境未就绪")
	}
	if lease.Surface != "shell" {
		return lease.Address, nil
	}
	target := lease.Address
	if !strings.Contains(target, "://") {
		target = "http://" + target
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return "", err
	}
	client := &http.Client{Timeout: 4 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 8<<10))
	return strings.TrimSpace(string(body)), nil
}

func emptyLease(owner Owner) Lease {
	return Lease{
		Schema:    LeaseSchema,
		OwnerKind: owner.Kind,
		OwnerID:   owner.ID,
		State:     "none",
		UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
}

func instanceDirectory(dataDirectory string, owner Owner, packageID string) string {
	return strings.TrimRight(dataDirectory, "/") + "/envbroker/instances/" + sanitizeOwner(owner) + "/" + packageID
}

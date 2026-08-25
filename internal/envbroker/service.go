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
	dataDirectory  string
	store          *Store
	compose        composeRunner
	android        androidRunner
	apks           apkFetcher
	waitReady      func(context.Context, string) error
	mu             sync.Mutex
	inflight       map[string]context.CancelFunc
	autoCreateAVD  bool
	androidTooling AndroidTooling
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
		apks:          httpAPKFetcher{},
		waitReady:     waitHTTPReady,
		inflight:      map[string]context.CancelFunc{},
		autoCreateAVD: true,
		androidTooling: AndroidTooling{AutoCreateAVD: true},
	}, nil
}

func (s *Service) SetAndroidTooling(tooling AndroidTooling) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.androidTooling = tooling
	s.autoCreateAVD = tooling.AutoCreateAVD
	if _, ok := s.android.(execAndroidRunner); ok {
		s.android = execAndroidRunner{
			sdkRoot:  strings.TrimSpace(tooling.SDKRoot),
			javaHome: strings.TrimSpace(tooling.JavaHome),
		}
	}
}

func (s *Service) androidStartOptions() (androidRunner, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.android, s.autoCreateAVD
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

func (s *Service) List() []Lease {
	return s.store.All()
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
	if occupant, busy := s.store.Occupant(item, owner); busy {
		lease := emptyLease(owner)
		lease.State = "busy"
		lease.PackageID = item.ID
		lease.PackageName = item.Name
		lease.Provider = item.Provider
		lease.Surface = item.Surface
		lease.Address = item.Address
		lease.OccupyOwner = occupant.OwnerKind + ":" + occupant.OwnerID
		lease.OccupyTitle = occupyTitle(occupant)
		lease.Error = "被作业 " + lease.OccupyTitle + " 占用"
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
		runner, autoCreate := s.androidStartOptions()
		if _, err := ensureLabAVD(ctx, runner, autoCreate); err != nil {
			lease.State = "failed"
			lease.Error = err.Error()
			_ = s.store.Put(lease)
			return lease, nil
		}
		heldDevices, _, holder := s.store.HeldAndroid(owner)
		names, listErr := listAvds(runner)
		if listErr != nil {
			lease.State = "failed"
			lease.Error = listErr.Error()
			_ = s.store.Put(lease)
			return lease, nil
		}
		hasFree := false
		for _, name := range labAVDs(names) {
			if !heldDevices[name] {
				hasFree = true
				break
			}
		}
		if !hasFree && labSystemImage(runner) == "" {
			lease.State = "busy"
			lease.OccupyOwner = holder.OwnerKind + ":" + holder.OwnerID
			lease.OccupyTitle = occupyTitle(holder)
			lease.Error = "被作业 " + lease.OccupyTitle + " 占用"
			_ = s.store.Put(lease)
			return lease, nil
		}
		_ = s.store.Put(lease)
		s.spawn(owner, func(run context.Context) {
			s.runAndroidStart(run, item, lease)
		})
		return lease, nil
	}
	lease.State = "failed"
	lease.Error = "不支持的 Provider"
	_ = s.store.Put(lease)
	return lease, nil
}

func occupyTitle(lease Lease) string {
	if strings.TrimSpace(lease.OccupyTitle) != "" {
		return lease.OccupyTitle
	}
	if strings.TrimSpace(lease.PackageName) != "" {
		return lease.PackageName
	}
	if strings.TrimSpace(lease.OccupyOwner) != "" {
		return lease.OccupyOwner
	}
	return lease.OwnerKind + ":" + lease.OwnerID
}

func (s *Service) runDockerStart(ctx context.Context, item Package, directory string, lease Lease) {
	if err := startCompose(ctx, s.compose, directory, projectName(item), func(line string) {
		line = strings.TrimSpace(line)
		if line == "" {
			return
		}
		lease.Detail = line
		_ = s.store.Put(lease)
	}); err != nil {
		lease.State = "failed"
		lease.Error = err.Error()
		_ = s.store.Put(lease)
		return
	}
	if s.waitReady != nil && item.Address != "" {
		if err := s.waitReady(ctx, item.Address); err != nil {
			lease.State = "failed"
			lease.Error = err.Error()
			_ = s.store.Put(lease)
			return
		}
	}
	if ctx.Err() != nil {
		return
	}
	lease.State = "ready"
	lease.Error = ""
	lease.Detail = item.Detail
	_ = s.store.Put(lease)
}

func (s *Service) runAndroidStart(ctx context.Context, item Package, lease Lease) {
	heldDevices, heldSerials, holder := s.store.HeldAndroid(Owner{Kind: lease.OwnerKind, ID: lease.OwnerID})
	runner, autoCreate := s.androidStartOptions()
	device, err := allocateAndroidDevice(ctx, runner, heldDevices, heldSerials, autoCreate)
	if err != nil {
		if err == errAndroidBusy {
			lease.State = "busy"
			lease.OccupyOwner = holder.OwnerKind + ":" + holder.OwnerID
			lease.OccupyTitle = occupyTitle(holder)
			lease.Error = "被作业 " + lease.OccupyTitle + " 占用"
			_ = s.store.Put(lease)
			return
		}
		lease.State = "failed"
		lease.Error = err.Error()
		_ = s.store.Put(lease)
		return
	}
	lease.Device = device.AVD
	lease.Address = device.Serial
	lease.Detail = device.AVD + " · " + device.Serial
	_ = s.store.Put(lease)
	if item.ApkURL != "" {
		apkPath, cacheErr := cacheAndroidAPK(ctx, s.apks, s.dataDirectory, item)
		if cacheErr != nil {
			lease.State = "failed"
			lease.Error = cacheErr.Error()
			_ = s.store.Put(lease)
			return
		}
		if installErr := installAndroidLab(ctx, s.android, device.Serial, apkPath, item.Launcher); installErr != nil {
			lease.State = "failed"
			lease.Error = installErr.Error()
			_ = s.store.Put(lease)
			return
		}
		lease.Detail = "已安装 " + item.Name + " · " + device.AVD + " · adb -s " + device.Serial
	}
	if ctx.Err() != nil {
		return
	}
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
	if lease.State == "pulling" || lease.State == "busy" {
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
		if state == "ready" {
			if item.Address != "" && !httpReady(ctx, item.Address) {
				lease.State = "failed"
				lease.Error = item.Address + " 未响应"
			} else {
				lease.State = "ready"
				lease.Error = ""
			}
		} else if state == "stopped" {
			lease.State = "stopped"
		}
		_ = s.store.Put(lease)
		return lease
	}
	if item.Provider == "android-avd" {
		serial, state, err := androidStatus(ctx, s.android, lease.Address)
		if err != nil && state != "ready" {
			lease.Error = err.Error()
		}
		if serial != "" {
			lease.Address = serial
		}
		if state == "ready" && androidPackageName(item.Launcher) != "" {
			if !androidPackageInstalled(ctx, s.android, serial, androidPackageName(item.Launcher)) {
				lease.State = "failed"
				lease.Error = "模拟器已启动，练习 APK 未安装"
				_ = s.store.Put(lease)
				return lease
			}
		}
		lease.State = state
		if state == "ready" {
			lease.Error = ""
		}
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

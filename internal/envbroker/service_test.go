package envbroker

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fakeCompose struct {
	dockerDown bool
	calls      []string
	running    bool
}

func (f *fakeCompose) LookPath(name string) (string, error) {
	if name == "docker" {
		return "/usr/bin/docker", nil
	}
	return "", os.ErrNotExist
}

func (f *fakeCompose) Run(_ context.Context, _ string, args []string, _ string) ([]byte, error) {
	joined := strings.Join(args, " ")
	f.calls = append(f.calls, joined)
	if strings.Contains(joined, "version") {
		if f.dockerDown {
			return []byte("Cannot connect"), os.ErrNotExist
		}
		return []byte("29.0.0"), nil
	}
	if strings.Contains(joined, "up --detach") {
		f.running = true
		return []byte("Started"), nil
	}
	if strings.Contains(joined, "ps --format") {
		if f.running {
			return []byte("running"), nil
		}
		return []byte(""), nil
	}
	if strings.Contains(joined, "down") {
		f.running = false
		return []byte("Removed"), nil
	}
	return nil, nil
}

type fakeAndroid struct {
	avds      []string
	booted    bool
	installed bool
	calls     []string
}

func (f *fakeAndroid) LookPath(name string) (string, error) {
	return "/sdk/" + name, nil
}

func (f *fakeAndroid) CombinedOutput(_ context.Context, name string, args ...string) ([]byte, error) {
	joined := name + " " + strings.Join(args, " ")
	f.calls = append(f.calls, joined)
	if strings.Contains(joined, "-list-avds") {
		return []byte(strings.Join(f.avds, "\n")), nil
	}
	if strings.Contains(joined, "adb devices") {
		if f.booted {
			return []byte("List of devices\nemulator-5554\tdevice\n"), nil
		}
		return []byte("List of devices\n"), nil
	}
	if strings.Contains(joined, "getprop sys.boot_completed") {
		if f.booted {
			return []byte("1\n"), nil
		}
		return []byte("0\n"), nil
	}
	if strings.Contains(joined, "emu kill") {
		f.booted = false
		return []byte("OK"), nil
	}
	if strings.Contains(joined, "install") {
		f.installed = true
		return []byte("Success"), nil
	}
	if strings.Contains(joined, "pm path") {
		if f.installed {
			return []byte("package:/data/app/b3nac.injuredandroid.apk\n"), nil
		}
		return []byte(""), os.ErrNotExist
	}
	if strings.Contains(joined, "am start") {
		return []byte("Starting"), nil
	}
	return nil, nil
}

func (f *fakeAndroid) StartDetached(_ string, _ ...string) error {
	f.booted = true
	return nil
}

func waitLease(t *testing.T, service *Service, owner Owner, want string) Lease {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	var lease Lease
	for time.Now().Before(deadline) {
		lease = service.Get(owner)
		if lease.State == want {
			return lease
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("wanted state %s, got %+v", want, lease)
	return lease
}

func TestStartStopDockerLease(t *testing.T) {
	t.Parallel()
	compose := &fakeCompose{}
	service, err := NewForTest(t.TempDir(), compose, &fakeAndroid{avds: []string{"Pixel"}})
	if err != nil {
		t.Fatal(err)
	}
	owner := Owner{Kind: "lab", ID: "job-1"}
	lease, err := service.Start(context.Background(), owner, "juice-shop")
	if err != nil {
		t.Fatal(err)
	}
	if lease.State != "pulling" && lease.State != "ready" {
		t.Fatalf("lease: %+v", lease)
	}
	lease = waitLease(t, service, owner, "ready")
	if lease.Address != "127.0.0.1:3000" || lease.Surface != "browser" {
		t.Fatalf("lease: %+v", lease)
	}
	got := service.Status(context.Background(), owner)
	if got.State != "ready" {
		t.Fatalf("status: %+v", got)
	}
	stopped, err := service.Stop(context.Background(), owner)
	if err != nil {
		t.Fatal(err)
	}
	if stopped.State != "stopped" {
		t.Fatalf("stopped: %+v", stopped)
	}
}

func TestDockerDownIsHonest(t *testing.T) {
	t.Parallel()
	compose := &fakeCompose{dockerDown: true}
	service, err := NewForTest(t.TempDir(), compose, nil)
	if err != nil {
		t.Fatal(err)
	}
	lease, err := service.Start(context.Background(), Owner{Kind: "cve", ID: "CVE-1"}, "whoami")
	if err != nil || lease.State != "docker-down" {
		t.Fatalf("expected docker-down, got %+v err=%v", lease, err)
	}
}

func TestOccupancyBlocksSecondOwner(t *testing.T) {
	t.Parallel()
	compose := &fakeCompose{}
	service, err := NewForTest(t.TempDir(), compose, nil)
	if err != nil {
		t.Fatal(err)
	}
	owner := Owner{Kind: "lab", ID: "a"}
	if _, err := service.Start(context.Background(), owner, "juice-shop"); err != nil {
		t.Fatal(err)
	}
	waitLease(t, service, owner, "ready")
	lease, err := service.Start(context.Background(), Owner{Kind: "cve", ID: "CVE-1"}, "juice-shop")
	if err != nil || lease.State != "busy" {
		t.Fatalf("expected busy, got %+v err=%v", lease, err)
	}
}

func TestAndroidLeaseUsesHostEmulator(t *testing.T) {
	t.Parallel()
	android := &fakeAndroid{avds: []string{"Pixel_7_API_34"}}
	service, err := NewForTest(t.TempDir(), &fakeCompose{dockerDown: true}, android)
	if err != nil {
		t.Fatal(err)
	}
	owner := Owner{Kind: "lab", ID: "phone"}
	lease, err := service.Start(context.Background(), owner, "android-avd")
	if err != nil {
		t.Fatal(err)
	}
	if lease.State != "pulling" && lease.State != "ready" {
		t.Fatalf("android lease: %+v", lease)
	}
	lease = waitLease(t, service, owner, "ready")
	if lease.Surface != "emulator" || lease.Address != "emulator-5554" {
		t.Fatalf("android lease: %+v", lease)
	}
}

func TestPackageForCVEEmptyWhenUnlisted(t *testing.T) {
	t.Parallel()
	if _, ok := PackageForCVE("CVE-2023-46604"); ok {
		t.Fatal("unexpected match")
	}
}

func TestStrutsPackageMatchesCVE20175638(t *testing.T) {
	t.Parallel()
	item, ok := PackageForCVE("CVE-2017-5638")
	if !ok || item.ID != "struts2-s2-045" || item.Surface != "browser" {
		t.Fatalf("%+v ok=%v", item, ok)
	}
}

func TestWhoamiIsShellSurface(t *testing.T) {
	t.Parallel()
	item, ok := PackageByID("whoami")
	if !ok || item.Surface != "shell" {
		t.Fatalf("%+v", item)
	}
}

func TestCatalogPinsExpectedPackages(t *testing.T) {
	t.Parallel()
	want := []string{"juice-shop", "webgoat", "struts2-s2-045", "whoami", "android-avd", "android-lab"}
	got := map[string]Package{}
	for _, item := range Catalog() {
		got[item.ID] = item
	}
	for _, id := range want {
		if _, ok := got[id]; !ok {
			t.Fatalf("missing package %s", id)
		}
	}
}

type fileAPKFetcher struct {
	source string
}

func (f fileAPKFetcher) Fetch(_ context.Context, _, destination string) error {
	data, err := os.ReadFile(f.source)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return err
	}
	return os.WriteFile(destination, data, 0o600)
}

func TestAndroidLabInstallsAPKWhenEmulatorAlreadyUp(t *testing.T) {
	t.Parallel()
	source := filepath.Join(t.TempDir(), "InjuredAndroid.apk")
	payload := []byte("fixture-apk")
	if err := os.WriteFile(source, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(payload)
	android := &fakeAndroid{avds: []string{"Pixel_10_Pro"}, booted: true}
	root := t.TempDir()
	service, err := NewForTest(root, &fakeCompose{dockerDown: true}, android)
	if err != nil {
		t.Fatal(err)
	}
	service.apks = fileAPKFetcher{source: source}
	item := Package{
		ID:        "android-lab",
		Name:      "InjuredAndroid",
		Provider:  "android-avd",
		Surface:   "emulator",
		Address:   "emulator-5554",
		ApkURL:    "https://example.invalid/InjuredAndroid.apk",
		ApkSHA256: hex.EncodeToString(sum[:]),
		ApkName:   "InjuredAndroid.apk",
		Launcher:  "b3nac.injuredandroid/.MainActivity",
	}
	lease := Lease{
		Schema:      LeaseSchema,
		OwnerKind:   "lab",
		OwnerID:     "android-lab",
		PackageID:   item.ID,
		PackageName: item.Name,
		Provider:    item.Provider,
		Surface:     item.Surface,
		State:       "pulling",
		Address:     item.Address,
	}
	service.runAndroidStart(context.Background(), item, lease)
	got := service.Get(Owner{Kind: "lab", ID: "android-lab"})
	if got.State != "ready" || got.Address != "emulator-5554" {
		t.Fatalf("%+v", got)
	}
	joined := strings.Join(android.calls, "\n")
	if !strings.Contains(joined, "install") || !strings.Contains(joined, "am start") {
		t.Fatalf("expected install and launch, calls=%q", joined)
	}
	if !strings.Contains(got.Detail, "InjuredAndroid") {
		t.Fatalf("detail: %s", got.Detail)
	}
	if status := service.Status(context.Background(), Owner{Kind: "lab", ID: "android-lab"}); status.State != "ready" {
		t.Fatalf("status after install: %+v", status)
	}
}

func TestAndroidLabAndBlankAVDShareOccupancy(t *testing.T) {
	t.Parallel()
	android := &fakeAndroid{avds: []string{"Pixel_10_Pro"}}
	service, err := NewForTest(t.TempDir(), &fakeCompose{dockerDown: true}, android)
	if err != nil {
		t.Fatal(err)
	}
	owner := Owner{Kind: "lab", ID: "blank"}
	if _, err := service.Start(context.Background(), owner, "android-avd"); err != nil {
		t.Fatal(err)
	}
	waitLease(t, service, owner, "ready")
	lease, err := service.Start(context.Background(), Owner{Kind: "lab", ID: "injured"}, "android-lab")
	if err != nil || lease.State != "busy" {
		t.Fatalf("expected busy, got %+v err=%v", lease, err)
	}
}

func TestAndroidLabStatusRequiresInstalledAPK(t *testing.T) {
	t.Parallel()
	android := &fakeAndroid{avds: []string{"Pixel"}, booted: true}
	service, err := NewForTest(t.TempDir(), &fakeCompose{dockerDown: true}, android)
	if err != nil {
		t.Fatal(err)
	}
	owner := Owner{Kind: "lab", ID: "missing-apk"}
	if err := service.store.Put(Lease{
		Schema:      LeaseSchema,
		OwnerKind:   owner.Kind,
		OwnerID:     owner.ID,
		PackageID:   "android-lab",
		PackageName: "InjuredAndroid",
		Provider:    "android-avd",
		Surface:     "emulator",
		State:       "ready",
		Address:     "emulator-5554",
	}); err != nil {
		t.Fatal(err)
	}
	got := service.Status(context.Background(), owner)
	if got.State != "stopped" {
		t.Fatalf("expected stopped until APK is installed, got %+v", got)
	}
}

func TestAndroidLabPinsInjuredAndroid(t *testing.T) {
	t.Parallel()
	item, ok := PackageByID("android-lab")
	if !ok {
		t.Fatal("android-lab missing")
	}
	if item.ApkSHA256 != "b6b8d2dbd7a428b7754e6e537ba5790c35a73253533454e0768dbf1520a7ed15" {
		t.Fatalf("apk pin: %s", item.ApkSHA256)
	}
	if item.Launcher != "b3nac.injuredandroid/.MainActivity" || len(item.Challenges) != 12 || item.Brief == "" {
		t.Fatalf("%+v", item)
	}
}

func TestComposePinsLoopbackAndInternalNetwork(t *testing.T) {
	t.Parallel()
	for _, id := range []string{"juice-shop", "webgoat", "struts2-s2-045", "whoami"} {
		item, ok := PackageByID(id)
		if !ok {
			t.Fatalf("missing %s", id)
		}
		data, err := composeBytes(item)
		if err != nil {
			t.Fatal(err)
		}
		text := string(data)
		if !strings.Contains(text, "127.0.0.1:") {
			t.Fatalf("%s missing loopback bind", id)
		}
		if !strings.Contains(text, "internal: true") {
			t.Fatalf("%s missing internal network", id)
		}
		if item.Brief == "" {
			t.Fatalf("%s missing brief", id)
		}
	}
}

func TestLiveAndroidAVD(t *testing.T) {
	if os.Getenv("MILKSU_ENVBROKER_LIVE") != "1" {
		t.Skip("set MILKSU_ENVBROKER_LIVE=1 to start the host AVD")
	}
	service, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := Owner{Kind: "lab", ID: "live-android"}
	lease, err := service.Start(context.Background(), owner, "android-avd")
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Minute)
	for time.Now().Before(deadline) {
		lease = service.Get(owner)
		if lease.State == "ready" && strings.HasPrefix(lease.Address, "emulator-") {
			return
		}
		if lease.State == "failed" {
			t.Fatalf("android start failed: %+v", lease)
		}
		time.Sleep(2 * time.Second)
	}
	t.Fatalf("android did not become ready: %+v", lease)
}

func TestLiveWhoamiDocker(t *testing.T) {
	if os.Getenv("MILKSU_ENVBROKER_LIVE_DOCKER") != "1" {
		t.Skip("set MILKSU_ENVBROKER_LIVE_DOCKER=1 to start whoami")
	}
	service, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := Owner{Kind: "lab", ID: "live-whoami"}
	if _, err := service.Start(context.Background(), owner, "whoami"); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Minute)
	var lease Lease
	for time.Now().Before(deadline) {
		lease = service.Get(owner)
		if lease.State == "ready" {
			body, probeErr := service.Probe(context.Background(), owner)
			if probeErr != nil {
				t.Fatal(probeErr)
			}
			if !strings.Contains(strings.ToLower(body), "hostname") && !strings.Contains(body, "GET") {
				t.Fatalf("probe body: %q", body)
			}
			_, _ = service.Stop(context.Background(), owner)
			return
		}
		if lease.State == "failed" || lease.State == "docker-down" {
			t.Fatalf("whoami start failed: %+v", lease)
		}
		time.Sleep(1 * time.Second)
	}
	t.Fatalf("whoami did not become ready: %+v", lease)
}

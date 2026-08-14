package computercap

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestComputerUseDriverHelper(t *testing.T) {
	separator := -1
	for index, value := range os.Args {
		if value == "--" {
			separator = index
			break
		}
	}
	if separator < 0 || separator+1 >= len(os.Args) {
		return
	}
	arguments := os.Args[separator+1:]
	if arguments[0] == "--version" {
		fmt.Printf("cua-driver %s\n", DriverVersion)
		return
	}
	if arguments[0] != "serve" {
		os.Exit(64)
	}
	socketPath := ""
	for index, value := range arguments {
		if value == "--socket" && index+1 < len(arguments) {
			socketPath = arguments[index+1]
			break
		}
	}
	if socketPath == "" {
		os.Exit(64)
	}
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		os.Exit(70)
	}
	defer listener.Close()
	for {
		connection, err := listener.Accept()
		if err != nil {
			return
		}
		_ = connection.Close()
	}
}

func helperCommand(_ string, arguments ...string) *exec.Cmd {
	if len(arguments) == 1 && arguments[0] == "--version" {
		return exec.Command("/bin/echo", "cua-driver "+DriverVersion)
	}
	values := []string{"-test.run=^TestComputerUseDriverHelper$", "--"}
	values = append(values, arguments...)
	return exec.Command(os.Args[0], values...)
}

func failingServeCommand(_ string, arguments ...string) *exec.Cmd {
	if len(arguments) == 1 && arguments[0] == "--version" {
		return exec.Command("/bin/echo", "cua-driver "+DriverVersion)
	}
	return exec.Command("/usr/bin/false")
}

func TestManagerStartsOneVisibleScopedSessionAndCleansIt(t *testing.T) {
	target := Target{
		Name:        "Codex",
		BundleID:    "com.openai.codex",
		PID:         4242,
		WindowID:    9001,
		WindowTitle: "MilkSU task",
	}
	manager := New(Options{
		BinaryPath:      os.Args[0],
		TargetPID:       1111, // host PID must differ from external target PID 4242
		GOOS:            "darwin",
		PermissionProbe: func(bool) Permissions { return Permissions{true, true} },
		TargetProvider:  func() ([]Target, error) { return []Target{target}, nil },
		CommandFactory:  helperCommand,
		StartTimeout:    2 * time.Second,
	})
	defer manager.Close()

	targets, err := manager.Targets()
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 1 || targets[0] != target {
		t.Fatalf("unexpected target list: %#v", targets)
	}
	status, err := manager.Start(
		context.Background(),
		"conversation-1",
		TargetSelection{PID: target.PID, WindowID: target.WindowID},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Enabled ||
		status.Phase != "ready" ||
		status.ConversationID != "conversation-1" ||
		status.Target.PID != target.PID ||
		status.Target.BundleID != target.BundleID ||
		status.Target.WindowID != target.WindowID ||
		status.DriverVersion != DriverVersion {
		t.Fatalf("unexpected ready status: %#v", status)
	}
	descriptor, enabled := manager.Descriptor("conversation-1")
	if !enabled ||
		descriptor.TargetBundleID != target.BundleID ||
		descriptor.TargetName != target.Name ||
		descriptor.TargetPID != target.PID ||
		descriptor.TargetWindowID != target.WindowID ||
		descriptor.SocketPath != filepath.Join(
			runtimeRoot,
			descriptor.SessionID,
			"driver.sock",
		) {
		t.Fatalf("unexpected descriptor: %#v, enabled=%v", descriptor, enabled)
	}
	if _, err := manager.Start(
		context.Background(),
		"conversation-2",
		TargetSelection{PID: target.PID, WindowID: target.WindowID},
	); err == nil {
		t.Fatal("expected a second task to be refused")
	}
	if _, err := manager.Stop("conversation-2"); err == nil {
		t.Fatal("expected another task to be unable to stop the session")
	}
	if !manager.OwnsConversation("conversation-1") ||
		manager.OwnsConversation("conversation-2") {
		t.Fatal("session ownership was not conversation-scoped")
	}

	directory := filepath.Join(runtimeRoot, descriptor.SessionID)
	stopped, err := manager.Stop("conversation-1")
	if err != nil {
		t.Fatal(err)
	}
	if stopped.Enabled || stopped.ConversationID != "" {
		t.Fatalf("unexpected stopped status: %#v", stopped)
	}
	if _, err := os.Stat(directory); !os.IsNotExist(err) {
		t.Fatalf("runtime directory was not removed: %v", err)
	}
	if _, enabled := manager.Descriptor("conversation-1"); enabled {
		t.Fatal("stopped session still exposed a descriptor")
	}
	if manager.OwnsConversation("conversation-1") {
		t.Fatal("stopped session retained conversation ownership")
	}
}

func TestManagerRestoresPersistedTaskAuthorizationAfterRestart(t *testing.T) {
	grantDirectory := t.TempDir()
	originalTarget := Target{
		Name:        "MilkSU Beta",
		BundleID:    "com.milksu.app.beta",
		PID:         4242,
		WindowID:    9001,
		WindowTitle: "MilkSU Beta",
	}
	newTarget := originalTarget
	newTarget.PID = 4343
	newTarget.WindowID = 9010

	newManager := func(target Target) *Manager {
		return New(Options{
			BinaryPath:      os.Args[0],
			TargetPID:       1111,
			GOOS:            "darwin",
			PermissionProbe: func(bool) Permissions { return Permissions{true, true} },
			TargetProvider:  func() ([]Target, error) { return []Target{target}, nil },
			CommandFactory:  helperCommand,
			StartTimeout:    2 * time.Second,
			GrantDirectory:  grantDirectory,
		})
	}

	first := newManager(originalTarget)
	started, err := first.Start(
		context.Background(),
		"conversation-restore",
		TargetSelection{PID: originalTarget.PID, WindowID: originalTarget.WindowID},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !started.Authorized || started.GrantedTarget == nil {
		t.Fatalf("task authorization was not persisted: %#v", started)
	}
	first.Close()
	closed := first.StatusForConversation("conversation-restore")
	if closed.Enabled || !closed.Authorized || closed.GrantedTarget == nil {
		t.Fatalf("restart lost persisted task authorization: %#v", closed)
	}

	second := newManager(newTarget)
	defer second.Close()
	restored, authorized, err := second.Restore(
		context.Background(),
		"conversation-restore",
	)
	if err != nil {
		t.Fatal(err)
	}
	if !authorized || !restored.Authorized || !restored.Enabled ||
		restored.Target.PID != newTarget.PID ||
		restored.Target.WindowID != newTarget.WindowID {
		t.Fatalf("task authorization was not restored to the visible target: %#v", restored)
	}

	stopped, err := second.Stop("conversation-restore")
	if err != nil {
		t.Fatal(err)
	}
	if stopped.Enabled || stopped.Authorized || stopped.GrantedTarget != nil {
		t.Fatalf("explicit stop did not revoke task authorization: %#v", stopped)
	}
}

func TestManagerRestartsAnAuthorizedTaskAfterDriverFailure(t *testing.T) {
	target := Target{
		Name:        "MilkSU Beta",
		BundleID:    "com.milksu.app.beta",
		PID:         4242,
		WindowID:    9001,
		WindowTitle: "MilkSU Beta",
	}
	manager := New(Options{
		BinaryPath:      os.Args[0],
		TargetPID:       1111,
		GOOS:            "darwin",
		PermissionProbe: func(bool) Permissions { return Permissions{true, true} },
		TargetProvider:  func() ([]Target, error) { return []Target{target}, nil },
		CommandFactory:  helperCommand,
		StartTimeout:    2 * time.Second,
		GrantDirectory:  t.TempDir(),
	})
	defer manager.Close()

	started, err := manager.Start(
		context.Background(),
		"conversation-recover-driver",
		TargetSelection{PID: target.PID, WindowID: target.WindowID},
	)
	if err != nil {
		t.Fatal(err)
	}
	manager.mu.Lock()
	command := manager.active.command
	manager.mu.Unlock()
	killProcess(command)
	deadline := time.Now().Add(2 * time.Second)
	for manager.Status().Phase != "failed" && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if manager.Status().Phase != "failed" {
		t.Fatalf("driver did not reach failed state: %#v", manager.Status())
	}

	restored, authorized, err := manager.Restore(
		context.Background(),
		"conversation-recover-driver",
	)
	if err != nil {
		t.Fatal(err)
	}
	if !authorized || !restored.Enabled || !restored.Authorized {
		t.Fatalf("authorized task was not recovered: %#v", restored)
	}
	if restored.SessionID == started.SessionID {
		t.Fatal("failed driver session id was reused")
	}
}

func TestFailedAutomaticRestoreKeepsTaskAuthorizationForRetry(t *testing.T) {
	grantDirectory := t.TempDir()
	target := Target{
		Name:        "MilkSU Beta",
		BundleID:    "com.milksu.app.beta",
		PID:         4242,
		WindowID:    9001,
		WindowTitle: "MilkSU Beta",
	}
	store := newGrantStore(grantDirectory)
	if err := store.Save("conversation-retry-restore", target); err != nil {
		t.Fatal(err)
	}
	manager := New(Options{
		BinaryPath:      os.Args[0],
		TargetPID:       1111,
		GOOS:            "darwin",
		PermissionProbe: func(bool) Permissions { return Permissions{true, true} },
		TargetProvider:  func() ([]Target, error) { return []Target{target}, nil },
		CommandFactory:  failingServeCommand,
		StartTimeout:    200 * time.Millisecond,
		GrantDirectory:  grantDirectory,
	})
	defer manager.Close()

	status, authorized, err := manager.Restore(
		context.Background(),
		"conversation-retry-restore",
	)
	if err == nil {
		t.Fatal("expected automatic restore to report the failed driver start")
	}
	if !authorized || !status.Authorized || status.GrantedTarget == nil {
		t.Fatalf("failed restore revoked the user's task authorization: %#v", status)
	}
}

func TestCorruptTaskAuthorizationFailsClosed(t *testing.T) {
	store := newGrantStore(t.TempDir())
	target := Target{
		Name:     "MilkSU Beta",
		BundleID: "com.milksu.app.beta",
		PID:      4242,
		WindowID: 9001,
	}
	if err := store.Save("conversation-corrupt", target); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(store.path("conversation-corrupt"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, exists, err := store.Load("conversation-corrupt")
	if !exists || err == nil {
		t.Fatalf("corrupt authorization must remain visible and fail closed: exists=%v err=%v", exists, err)
	}
}

func TestResolveGrantedTargetRejectsAmbiguousReplacementWindows(t *testing.T) {
	granted := Target{
		Name:        "MilkSU Beta",
		BundleID:    "com.milksu.app.beta",
		PID:         4242,
		WindowID:    9001,
		WindowTitle: "Original task",
	}
	_, err := resolveGrantedTarget(granted, []Target{
		{Name: "MilkSU Beta", BundleID: granted.BundleID, PID: 5001, WindowID: 10, WindowTitle: "Task A"},
		{Name: "MilkSU Beta", BundleID: granted.BundleID, PID: 5001, WindowID: 11, WindowTitle: "Task B"},
	})
	if err == nil || !strings.Contains(err.Error(), "多个可见窗口") {
		t.Fatalf("expected ambiguous replacement windows to require selection, got %v", err)
	}
}

func TestManagerNeverPromptsAndOpensSettingsOnExplicitRequest(t *testing.T) {
	var prompts []bool
	var opened []PermissionKind
	manager := New(Options{
		BinaryPath: os.Args[0],
		TargetPID:  4242,
		GOOS:       "darwin",
		PermissionProbe: func(prompt bool) Permissions {
			prompts = append(prompts, prompt)
			return Permissions{}
		},
		PermissionOpen: func(permission PermissionKind) {
			opened = append(opened, permission)
		},
		CommandFactory: helperCommand,
	})
	status := manager.Status()
	if status.Enabled {
		t.Fatal("status unexpectedly enabled Computer Use")
	}
	if len(prompts) != 1 || prompts[0] {
		t.Fatalf("status prompted for a system grant: %#v", prompts)
	}
	if _, err := manager.Start(context.Background(), "conversation-1", TargetSelection{}); err == nil {
		t.Fatal("expected missing grants to prevent startup")
	}
	for _, prompt := range prompts {
		if prompt {
			t.Fatalf("startup prompted implicitly: %#v", prompts)
		}
	}
	if _, err := manager.RequestPermission(PermissionScreenRecording); err != nil {
		t.Fatalf("request permission: %v", err)
	}
	for _, prompt := range prompts {
		if prompt {
			t.Fatalf("explicit permission request should not trigger a repeat TCC prompt: %#v", prompts)
		}
	}
	if len(opened) != 1 {
		t.Fatalf("explicit permission request should open settings once: %#v", opened)
	}
	if opened[0] != PermissionScreenRecording {
		t.Fatalf("opened wrong permission pane: %#v", opened)
	}
}

func TestManagerReportsSigningDiagnostics(t *testing.T) {
	manager := New(Options{
		BinaryPath:   os.Args[0],
		TargetPID:    4242,
		HostBundleID: defaultHostBundleID,
		GOOS:         "darwin",
		PermissionProbe: func(bool) Permissions {
			return Permissions{Accessibility: false, ScreenRecording: true}
		},
		SigningProbe: func() SigningStatus {
			return SigningStatus{
				BundleID:       defaultHostBundleID,
				ExecutablePath: "/Applications/MilkSU.app",
				Signature:      "adhoc",
				TeamIdentifier: "not set",
				StableIdentity: false,
				Problem:        "当前构建不是稳定 Developer ID 签名",
			}
		},
		CommandFactory: helperCommand,
	})

	status := manager.Status()
	if status.Signing.BundleID != defaultHostBundleID ||
		status.Signing.ExecutablePath != "/Applications/MilkSU.app" ||
		status.Signing.Signature != "adhoc" ||
		status.Signing.TeamIdentifier != "not set" ||
		status.Signing.StableIdentity {
		t.Fatalf("unexpected signing diagnostics: %#v", status.Signing)
	}
	if !strings.Contains(status.Signing.Problem, "Developer ID") {
		t.Fatalf("missing signing problem detail: %#v", status.Signing)
	}
}

func TestFilterValidTargetsExcludesOnlyHostIdentity(t *testing.T) {
	stableHost := "com.milksu.app"
	betaHost := "com.milksu.app.beta"
	targets := []Target{
		{Name: "MilkSU", BundleID: stableHost, PID: 100, WindowID: 1},
		{Name: "MilkSU Beta", BundleID: betaHost, PID: 200, WindowID: 2},
		{Name: "TextEdit", BundleID: "com.apple.TextEdit", PID: 300, WindowID: 3},
		{Name: "Preview", BundleID: "com.apple.Preview", PID: 100, WindowID: 4}, // same PID as host
	}

	// Stable host must drop itself and same-PID windows, but keep Beta + external apps.
	stableListed := filterValidTargets(targets, stableHost, 100)
	if len(stableListed) != 2 {
		t.Fatalf("stable host listed %#v", stableListed)
	}
	for _, target := range stableListed {
		if target.BundleID == stableHost {
			t.Fatalf("stable host failed to exclude self: %#v", target)
		}
		if target.PID == 100 {
			t.Fatalf("stable host failed to exclude host PID: %#v", target)
		}
	}
	foundBeta := false
	for _, target := range stableListed {
		if target.BundleID == betaHost {
			foundBeta = true
		}
	}
	if !foundBeta {
		t.Fatal("stable host must still list MilkSU Beta as a selectable target")
	}

	// Beta host excludes Beta only; Stable remains targetable.
	betaListed := filterValidTargets(targets, betaHost, 200)
	for _, target := range betaListed {
		if target.BundleID == betaHost {
			t.Fatalf("beta host failed to exclude self: %#v", target)
		}
	}
	foundStable := false
	for _, target := range betaListed {
		if target.BundleID == stableHost {
			foundStable = true
		}
	}
	if !foundStable {
		t.Fatal("beta host must still list MilkSU stable as a selectable target")
	}

	if isSelfComputerUseTarget(Target{BundleID: betaHost, PID: 200}, stableHost, 100) {
		t.Fatal("beta must not be treated as self when host is stable")
	}
	if !isSelfComputerUseTarget(Target{BundleID: stableHost, PID: 999}, stableHost, 100) {
		t.Fatal("same bundle as host must be treated as self")
	}
}

func TestManagerUsesInjectedHostBundleID(t *testing.T) {
	manager := New(Options{
		BinaryPath:   os.Args[0],
		TargetPID:    55,
		HostBundleID: "com.milksu.app.beta",
		GOOS:         "darwin",
		PermissionProbe: func(bool) Permissions {
			return Permissions{true, true}
		},
		SigningProbe: func() SigningStatus {
			return SigningStatus{BundleID: "com.milksu.app.beta", Signature: "adhoc"}
		},
		CommandFactory: helperCommand,
	})
	if manager.HostBundleID() != "com.milksu.app.beta" {
		t.Fatalf("host bundle id not injected: %s", manager.HostBundleID())
	}
	status := manager.Status()
	if status.Signing.BundleID != "com.milksu.app.beta" {
		t.Fatalf("status signing bundle: %#v", status.Signing)
	}
	if status.Target.BundleID != "com.milksu.app.beta" || status.Target.Name != "MilkSU Beta" {
		t.Fatalf("default target not host-aware: %#v", status.Target)
	}
}

func TestSessionManifestDeniesDesktopAndUnreviewedTools(t *testing.T) {
	manifest := sessionManifest("com.openai.codex")
	for _, expected := range []string{
		"version: 2",
		"mode: bounded",
		"bundle_id: com.openai.codex",
		"launch: false",
		"- start_session",
		"- get_window_state",
		"- click",
		"- type_text",
		"- press_key",
		"- scroll",
		"- get_desktop_state",
		"- launch_app",
		"- escalate_session",
	} {
		if !strings.Contains(manifest, expected) {
			t.Fatalf("bounded manifest is missing %q:\n%s", expected, manifest)
		}
	}
}

func TestDarwinTargetDiscoveryRejectsTinyOverlayWindows(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("targets_darwin.go"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	for _, expected := range []string{
		"milksu_minimum_target_window_width",
		"milksu_minimum_target_window_height",
		"kCGWindowBounds",
		"CGRectMakeWithDictionaryRepresentation",
		"rect.size.width < milksu_minimum_target_window_width",
		"rect.size.height < milksu_minimum_target_window_height",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("darwin target discovery no longer filters tiny overlay windows: missing %q", expected)
		}
	}
}

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
		TargetPID:       4242,
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

func TestManagerNeverPromptsAndOpensSettingsOnExplicitRequest(t *testing.T) {
	var prompts []bool
	var opened []Permissions
	manager := New(Options{
		BinaryPath: os.Args[0],
		TargetPID:  4242,
		GOOS:       "darwin",
		PermissionProbe: func(prompt bool) Permissions {
			prompts = append(prompts, prompt)
			return Permissions{}
		},
		PermissionOpen: func(permissions Permissions) {
			opened = append(opened, permissions)
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
	manager.RequestPermissions()
	for _, prompt := range prompts {
		if prompt {
			t.Fatalf("explicit permission request should not trigger a repeat TCC prompt: %#v", prompts)
		}
	}
	if len(opened) != 1 {
		t.Fatalf("explicit permission request should open settings once: %#v", opened)
	}
}

func TestManagerReportsSigningDiagnostics(t *testing.T) {
	manager := New(Options{
		BinaryPath: os.Args[0],
		TargetPID:  4242,
		GOOS:       "darwin",
		PermissionProbe: func(bool) Permissions {
			return Permissions{Accessibility: false, ScreenRecording: true}
		},
		SigningProbe: func() SigningStatus {
			return SigningStatus{
				BundleID:       hostBundleID,
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
	if status.Signing.BundleID != hostBundleID ||
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

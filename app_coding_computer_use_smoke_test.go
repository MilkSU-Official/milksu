package main

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/computercap"
	"github.com/MilkSU-Official/milksu/internal/engine"
)

func TestAppComputerUseDriverHelper(t *testing.T) {
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
		fmt.Printf("cua-driver %s\n", computercap.DriverVersion)
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

func appComputerUseDriverCommand(_ string, arguments ...string) *exec.Cmd {
	if len(arguments) == 1 && arguments[0] == "--version" {
		return exec.Command("/bin/echo", "cua-driver "+computercap.DriverVersion)
	}
	values := []string{"-test.run=^TestAppComputerUseDriverHelper$", "--"}
	values = append(values, arguments...)
	return exec.Command(os.Args[0], values...)
}

func TestMaybeRunComputerUseAppSmokeStartsAndStopsVisibleTarget(t *testing.T) {
	dataDirectory := t.TempDir()
	reportPath := filepath.Join(t.TempDir(), "computer-use-app-smoke.json")
	target := computercap.Target{
		Name:        "Calculator",
		BundleID:    "com.apple.calculator",
		PID:         4242,
		WindowID:    9001,
		WindowTitle: "Calculator",
	}
	t.Setenv(computerUseAppSmokeResultEnv, reportPath)
	t.Setenv(computerUseAppSmokeConversationEnv, "conversation-computer-use-app-smoke")
	t.Setenv(computerUseAppSmokeTargetBundleEnv, target.BundleID)
	t.Setenv(computerUseAppSmokeTargetPIDEnv, fmt.Sprint(target.PID))

	application := &App{
		dataDirectory: dataDirectory,
		diagnostics:   appdata.NewDiagnosticRecorder(32),
		engines:       engine.NewSupervisor(nil),
		computerUse: computercap.New(computercap.Options{
			BinaryPath: os.Args[0],
			TargetPID:  7777,
			GOOS:       "darwin",
			PermissionProbe: func(bool) computercap.Permissions {
				return computercap.Permissions{
					Accessibility:   true,
					ScreenRecording: true,
				}
			},
			TargetProvider: func() ([]computercap.Target, error) {
				return []computercap.Target{
					{
						Name:        "MilkSU",
						BundleID:    "com.milksu.app",
						PID:         7777,
						WindowID:    7001,
						WindowTitle: "MilkSU",
					},
					target,
				}, nil
			},
			CommandFactory: appComputerUseDriverCommand,
			StartTimeout:   2 * time.Second,
		}),
	}
	defer application.computerUse.Close()

	application.maybeRunComputerUseAppSmoke()

	payload, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatalf("read smoke report: %v", err)
	}
	var report computerUseAppSmokeReport
	if err := json.Unmarshal(payload, &report); err != nil {
		t.Fatalf("decode smoke report: %v", err)
	}
	if report.Schema != "milksu-computer-use-app-smoke/v1" || report.Error != "" {
		t.Fatalf("unexpected smoke report: %#v", report)
	}
	if report.TargetCount != 2 ||
		report.SelectedTarget != target ||
		!report.StartedStatus.Enabled ||
		report.StartedStatus.Phase != "ready" ||
		report.StartedStatus.ConversationID != "conversation-computer-use-app-smoke" ||
		report.StartedStatus.Target != target ||
		!report.ConfirmedStatus.Enabled ||
		!report.DescriptorEnabled ||
		report.Descriptor.TargetBundleID != target.BundleID ||
		report.Descriptor.TargetPID != target.PID ||
		report.Descriptor.TargetWindowID != target.WindowID ||
		!report.SocketPathExists {
		t.Fatalf("smoke report did not prove App-layer Computer Use startup: %#v", report)
	}
	if report.StoppedStatus.Enabled ||
		report.StoppedStatus.ConversationID != "" ||
		report.StoppedStatus.SessionID != "" {
		t.Fatalf("smoke report did not prove App-layer Computer Use stop: %#v", report.StoppedStatus)
	}
	if _, enabled := application.computerUse.Descriptor("conversation-computer-use-app-smoke"); enabled {
		t.Fatal("Computer Use descriptor remained enabled after smoke")
	}
	info, err := os.Stat(reportPath)
	if err != nil {
		t.Fatalf("stat smoke report: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("smoke report mode = %o, want 0600", info.Mode().Perm())
	}
}

func TestMaybeRunComputerUseAppSmokeReportsMissingTarget(t *testing.T) {
	reportPath := filepath.Join(t.TempDir(), "computer-use-app-smoke.json")
	t.Setenv(computerUseAppSmokeResultEnv, reportPath)
	t.Setenv(computerUseAppSmokeTargetBundleEnv, "com.apple.calculator")
	t.Setenv(computerUseAppSmokeTargetPIDEnv, "4242")

	application := &App{
		dataDirectory: t.TempDir(),
		diagnostics:   appdata.NewDiagnosticRecorder(32),
		engines:       engine.NewSupervisor(nil),
		computerUse: computercap.New(computercap.Options{
			BinaryPath: os.Args[0],
			TargetPID:  7777,
			GOOS:       "darwin",
			PermissionProbe: func(bool) computercap.Permissions {
				return computercap.Permissions{
					Accessibility:   true,
					ScreenRecording: true,
				}
			},
			TargetProvider: func() ([]computercap.Target, error) {
				return []computercap.Target{{
					Name:     "MilkSU",
					BundleID: "com.milksu.app",
					PID:      7777,
					WindowID: 7001,
				}}, nil
			},
			CommandFactory: appComputerUseDriverCommand,
			StartTimeout:   2 * time.Second,
		}),
	}
	defer application.computerUse.Close()

	application.maybeRunComputerUseAppSmoke()

	payload, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatalf("read smoke report: %v", err)
	}
	var report computerUseAppSmokeReport
	if err := json.Unmarshal(payload, &report); err != nil {
		t.Fatalf("decode smoke report: %v", err)
	}
	if report.Schema != "milksu-computer-use-app-smoke/v1" ||
		report.TargetCount != 1 ||
		report.Error == "" ||
		report.StartedStatus.Enabled {
		t.Fatalf("unexpected missing-target report: %#v", report)
	}
}

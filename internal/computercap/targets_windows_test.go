//go:build windows

package computercap

import (
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestWindowsPlatformTargetsListNotepadAndExcludeHost(t *testing.T) {
	notepad := exec.Command("notepad.exe")
	if err := notepad.Start(); err != nil {
		t.Fatalf("start notepad: %v", err)
	}
	defer killStartedProcess(notepad)

	listed := waitForWindowsTargets(t, 20*time.Second, windowsLooksLikeNotepad)
	if !windowsLooksLikeNotepad(listed) {
		fixture := exec.Command("cmd.exe", "/c", "start", "MilkSU-CUA-Fixture", "cmd.exe", "/k", "echo MilkSU-CUA-Fixture")
		if err := fixture.Start(); err != nil {
			t.Fatalf("start fixture window: %v", err)
		}
		defer func() {
			killStartedProcess(fixture)
			_ = exec.Command("taskkill", "/F", "/FI", "WINDOWTITLE eq MilkSU-CUA-Fixture*").Run()
		}()
		listed = waitForWindowsTargets(t, 15*time.Second, windowsLooksLikeFixture)
	}
	if !windowsLooksLikeNotepad(listed) && !windowsLooksLikeFixture(listed) {
		t.Fatalf("visible Notepad or fixture window was not listed for Computer Use: %#v", listed)
	}

	for _, target := range listed {
		if target.PID == os.Getpid() {
			t.Fatalf("Windows Computer Use listed the host process: %#v", target)
		}
	}
}

func waitForWindowsTargets(t *testing.T, limit time.Duration, match func([]Target) bool) []Target {
	t.Helper()
	var listed []Target
	deadline := time.Now().Add(limit)
	for time.Now().Before(deadline) {
		targets, err := platformTargets()
		if err != nil {
			t.Fatal(err)
		}
		listed = filterValidTargets(targets, defaultHostBundleID, os.Getpid())
		if match(listed) {
			return listed
		}
		time.Sleep(80 * time.Millisecond)
	}
	return listed
}

func windowsLooksLikeNotepad(targets []Target) bool {
	for _, target := range targets {
		haystack := strings.ToLower(strings.Join([]string{
			target.Name,
			target.BundleID,
			target.WindowTitle,
			target.executablePath,
		}, "\n"))
		if strings.Contains(haystack, "notepad") {
			return true
		}
	}
	return false
}

func windowsLooksLikeFixture(targets []Target) bool {
	for _, target := range targets {
		if strings.Contains(target.WindowTitle, "MilkSU-CUA-Fixture") {
			return true
		}
	}
	return false
}

func killStartedProcess(command *exec.Cmd) {
	if command == nil || command.Process == nil {
		return
	}
	_ = command.Process.Kill()
	_, _ = command.Process.Wait()
}

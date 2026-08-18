//go:build windows

package computercap

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWindowsPlatformTargetsListNotepadAndExcludeBrowsers(t *testing.T) {
	notepad := exec.Command("notepad.exe")
	if err := notepad.Start(); err != nil {
		t.Fatalf("start notepad: %v", err)
	}
	defer func() {
		if notepad.Process != nil {
			_ = notepad.Process.Kill()
			_, _ = notepad.Process.Wait()
		}
	}()

	var listed []Target
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		targets, err := platformTargets()
		if err != nil {
			t.Fatal(err)
		}
		listed = filterValidTargets(targets, defaultHostBundleID, os.Getpid())
		if windowsTargetNamed(listed, "notepad") {
			break
		}
		time.Sleep(80 * time.Millisecond)
	}
	if !windowsTargetNamed(listed, "notepad") {
		t.Fatalf("Notepad window was not listed for Computer Use: %#v", listed)
	}

	for _, target := range listed {
		if isUserBrowserTarget(target) {
			t.Fatalf("Windows Computer Use listed a browser window: %#v", target)
		}
		if target.PID == os.Getpid() {
			t.Fatalf("Windows Computer Use listed the host process: %#v", target)
		}
		if strings.EqualFold(filepath.Base(target.executablePath), "chrome.exe") ||
			strings.EqualFold(filepath.Base(target.executablePath), "msedge.exe") {
			t.Fatalf("Windows Computer Use listed a browser executable: %#v", target)
		}
	}
}

func windowsTargetNamed(targets []Target, name string) bool {
	for _, target := range targets {
		if strings.EqualFold(target.Name, name) && strings.EqualFold(target.BundleID, "win32."+name) {
			return true
		}
	}
	return false
}

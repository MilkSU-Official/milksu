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
		if target.PID == os.Getpid() {
			t.Fatalf("Windows Computer Use listed the host process: %#v", target)
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

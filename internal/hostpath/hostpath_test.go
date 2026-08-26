package hostpath

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestEphemeralRootUsesPlatformAPI(t *testing.T) {
	root := EphemeralRoot()
	if runtime.GOOS == "linux" {
		if dir := strings.TrimSpace(os.Getenv("XDG_RUNTIME_DIR")); dir != "" {
			if root != dir {
				t.Fatalf("linux ephemeral root = %q, want XDG_RUNTIME_DIR %q", root, dir)
			}
			return
		}
	}
	if root != os.TempDir() {
		t.Fatalf("ephemeral root = %q, want os.TempDir() %q", root, os.TempDir())
	}
}

func TestComputerUseSocketStaysUnderUnixLimit(t *testing.T) {
	if runtime.GOOS == "windows" {
		endpoint := ComputerUseSocket("windows", "computer_0123456789abcdef0123456789abcdef")
		if endpoint != `\\.\pipe\milksu-computer-use-computer_0123456789abcdef0123456789abcdef` {
			t.Fatalf("windows socket = %q", endpoint)
		}
		return
	}
	sessionID := "computer_0123456789abcdef0123456789abcdef"
	path := ComputerUseSocket(runtime.GOOS, sessionID)
	if len(path) > unixSocketMaxBytes {
		t.Fatalf("unix socket path too long (%d): %q", len(path), path)
	}
	root := filepath.Clean(EphemeralRoot())
	if !strings.HasPrefix(path, root+string(os.PathSeparator)) {
		t.Fatalf("socket %q is not under ephemeral root %q", path, root)
	}
	if strings.Contains(path, "milksu-computer-use"+string(os.PathSeparator)+sessionID) {
		t.Fatal("unix socket must not nest under the long session directory")
	}
}

func TestComputerUseSocketHashesWhenRootIsLong(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("named pipes have no sockaddr length cap")
	}
	root := filepath.Join(string(os.PathSeparator), strings.Repeat("d", 69))
	sessionID := "computer_0123456789abcdef0123456789abcdef"
	path := unixComputerUseSocket(root, sessionID)
	if len(path) > unixSocketMaxBytes {
		t.Fatalf("hashed socket still too long (%d): %q", len(path), path)
	}
	if path == filepath.Join(root, "mcu-0123456789abcdef0123456789abcdef.sock") {
		t.Fatal("expected a hashed socket name when the root is long")
	}
}

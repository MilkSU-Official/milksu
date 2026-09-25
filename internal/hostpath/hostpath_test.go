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

func TestDSHProductIpcStaysUnderUnixLimit(t *testing.T) {
	if runtime.GOOS == "windows" {
		endpoint := DSHProductIpc("windows", "bridge-123456789")
		if endpoint != `\\.\pipe\milksu-dsh-bridge-123456789` {
			t.Fatalf("windows socket = %q", endpoint)
		}
		return
	}
	path := DSHProductIpc(runtime.GOOS, "bridge-123456")
	if len(path) > unixSocketMaxBytes {
		t.Fatalf("unix socket path too long (%d): %q", len(path), path)
	}
	root := filepath.Clean(EphemeralRoot())
	if !strings.HasPrefix(path, root+string(os.PathSeparator)) && !strings.HasPrefix(path, unixSocketOverflowRoot()+string(os.PathSeparator)) {
		t.Fatalf("socket %q is not under ephemeral or overflow root", path)
	}
}

func TestDSHProductIpcFitsWhenRootIsProductWorkspaceTmp(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("named pipes have no sockaddr length cap")
	}
	root := filepath.Join(string(os.PathSeparator), strings.Repeat("d", 107))
	path := unixDSHProductIpc(root, "bridge-123456")
	if len(path) > unixSocketMaxBytes {
		t.Fatalf("bounded socket still too long (%d): %q", len(path), path)
	}
	if strings.HasPrefix(path, root+string(os.PathSeparator)) {
		t.Fatalf("socket kept overflowing root %q: %q", root, path)
	}
}

func TestDSHProductIpcStaysBoundedWhenTMPDIRIsProductWorkspaceTmp(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("named pipes have no sockaddr length cap")
	}
	long := filepath.Join(string(os.PathSeparator), strings.Repeat("d", 107))
	t.Setenv("TMPDIR", long)
	path := DSHProductIpc(runtime.GOOS, "bridge-123456")
	if len(path) > unixSocketMaxBytes {
		t.Fatalf("unix socket path too long under product TMPDIR (%d): %q", len(path), path)
	}
	if strings.HasPrefix(path, long+string(os.PathSeparator)) {
		t.Fatalf("socket followed product TMPDIR %q: %q", long, path)
	}
}

// 根路径长到装不下一个 socket 时（例如带中文的工作区），最后兜底的名字也必须落在 103 字节以内——
// 以前的兜底只把名字换成哈希，根一长照样超。
func TestComputerUseSocketStaysUnderTheLimitForAnOverlongRoot(t *testing.T) {
	long := filepath.Join(strings.Repeat("中文目录", 12), "workspace")
	path := unixComputerUseSocket(long, "computer_session_for_the_limit")
	if len(path) > unixSocketMaxBytes {
		t.Fatalf("socket path is %d bytes, over the %d limit: %s", len(path), unixSocketMaxBytes, path)
	}
	if !strings.HasSuffix(path, ".sock") {
		t.Fatalf("socket path must not be truncated: %s", path)
	}
	overflow := unixSocketOverflowRoot() + string(os.PathSeparator)
	temp := os.TempDir() + string(os.PathSeparator)
	if !strings.HasPrefix(path, overflow) && !strings.HasPrefix(path, temp) {
		t.Fatalf("fallback socket must land under the overflow or platform temp root: %s", path)
	}
}

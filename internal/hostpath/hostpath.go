package hostpath

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// unixSocketMaxBytes is the usable length of sockaddr_un.sun_path on Darwin
// (104 bytes including the terminating NUL). Linux allows 108; stay on the
// Darwin cap so the same name works on all Unix hosts.
const unixSocketMaxBytes = 103

// EphemeralRoot is the process-private temporary or runtime directory.
// Linux prefers $XDG_RUNTIME_DIR; every OS falls back to os.TempDir().
// Do not hardcode /tmp, /private/tmp, or /run/user/<uid>.
func EphemeralRoot() string {
	if runtime.GOOS == "linux" {
		if dir := strings.TrimSpace(os.Getenv("XDG_RUNTIME_DIR")); dir != "" {
			return dir
		}
	}
	return os.TempDir()
}

// ComputerUseRuntimeRoot holds Computer Use session files (policy, sandbox
// home/tmp). Unix sockets are not placed here; see ComputerUseSocket.
func ComputerUseRuntimeRoot() string {
	return filepath.Join(EphemeralRoot(), "milksu-computer-use")
}

// PlaywrightSocketRoot holds isolated Playwright MCP sockets.
func PlaywrightSocketRoot() string {
	return filepath.Join(EphemeralRoot(), "milksu-playwright")
}

// ComputerUseSocket is the private driver endpoint for a session.
// Windows uses a named pipe. Unix uses a short file in EphemeralRoot so the
// path stays under the sockaddr_un length cap; keep in sync with
// sidecar/hostpath.js.
func ComputerUseSocket(goos, sessionID string) string {
	if goos == "windows" {
		return `\\.\pipe\milksu-computer-use-` + sessionID
	}
	return unixComputerUseSocket(EphemeralRoot(), sessionID)
}

func unixComputerUseSocket(root, sessionID string) string {
	suffix := strings.TrimPrefix(sessionID, "computer_")
	candidate := filepath.Join(root, "mcu-"+suffix+".sock")
	if len(candidate) <= unixSocketMaxBytes {
		return candidate
	}
	sum := sha256.Sum256([]byte(sessionID))
	return filepath.Join(root, "mcu-"+hex.EncodeToString(sum[:8])+".sock")
}

// DSHProductIpc is the private product-MCP / host-plugin endpoint for a
// DeepSeek sidecar. Windows uses a named pipe. Unix uses a short file under
// EphemeralRoot so the path stays within sockaddr_un; it must not follow the
// Sidecar workspace TMPDIR. Keep in sync with sidecar/hostpath.js.
func DSHProductIpc(goos, id string) string {
	id = strings.TrimSpace(id)
	if id == "" {
		id = "session"
	}
	if goos == "windows" {
		if len(id) > 24 {
			id = id[len(id)-24:]
		}
		return `\\.\pipe\milksu-dsh-` + id
	}
	return unixDSHProductIpc(EphemeralRoot(), id)
}

func unixDSHProductIpc(root, id string) string {
	id = strings.TrimSpace(id)
	if id == "" {
		id = "session"
	}
	for _, candidateRoot := range []string{root, EphemeralRoot(), unixSocketOverflowRoot()} {
		if path := fitUnixSocket(candidateRoot, "dsh", id); path != "" {
			return path
		}
	}
	sum := sha256.Sum256([]byte(id))
	return hex.EncodeToString(sum[:8]) + ".sock"
}

func fitUnixSocket(root, prefix, id string) string {
	if strings.TrimSpace(root) == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(id))
	digest := hex.EncodeToString(sum[:8])
	for _, name := range []string{
		prefix + "-" + id + ".sock",
		prefix + "-" + digest + ".sock",
		digest + ".sock",
	} {
		candidate := filepath.Join(root, name)
		if len(candidate) <= unixSocketMaxBytes {
			return candidate
		}
	}
	return ""
}

func unixSocketOverflowRoot() string {
	if cache, err := os.UserCacheDir(); err == nil && strings.TrimSpace(cache) != "" {
		return filepath.Join(cache, "milksu-ipc")
	}
	if home, err := os.UserHomeDir(); err == nil && strings.TrimSpace(home) != "" {
		return filepath.Join(home, ".cache", "milksu-ipc")
	}
	return EphemeralRoot()
}

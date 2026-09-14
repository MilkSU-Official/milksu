// Package codingevidence derives and reveals the exact workspace-relative
// directory where an isolated Coding Browser conversation stores evidence
// (.milksu/browser-evidence/<sessionId>).
//
// The package is a small, Wails-free adapter on purpose: the security-critical
// path derivation must stay unit-testable without a desktop runtime, and
// cmd/milksu-backend/app.go must not grow new responsibilities.
package codingevidence

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// EvidenceRelativeDir is the workspace-relative directory that holds one
// conversation's Coding browser evidence. It mirrors
// sidecar/pi/bridge-browser-policy.js codingBrowserEvidenceRelativePath.
const EvidenceRelativeDir = ".milksu/browser-evidence"

// sessionIDPattern mirrors sidecar/pi/bridge-browser-policy.js: a session id can only
// ever select one safe directory segment below browser-evidence/.
var sessionIDPattern = regexp.MustCompile(`^browser_[A-Za-z0-9-]{8,128}$`)

// Request carries only trusted backend state for one conversation: the live
// session id owned by the isolated Coding browser and the workspace selected
// by the desktop adapter. The frontend/model never supplies either value.
type Request struct {
	ConversationID string
	SessionID      string
	Workspace      string
}

// ValidSessionID reports whether value is a managed Coding browser session id
// (browser_<uuid>) that cannot select a path outside its evidence segment.
func ValidSessionID(value string) bool {
	return sessionIDPattern.MatchString(strings.TrimSpace(value))
}

// Derive resolves the exact evidence directory for one conversation from
// trusted backend state only. It rejects a missing conversation id, a
// conversation without an active isolated browser session, an invalid session
// id, and every workspace or filesystem inconsistency (see deriveDirectory).
func Derive(request Request) (string, error) {
	if strings.TrimSpace(request.ConversationID) == "" {
		return "", fmt.Errorf("Coding 会话标识不能为空")
	}
	sessionID := strings.TrimSpace(request.SessionID)
	if sessionID == "" {
		return "", fmt.Errorf("当前会话没有活跃的浏览器")
	}
	if !ValidSessionID(sessionID) {
		return "", fmt.Errorf("浏览器会话标识无效")
	}
	return deriveDirectory(request.Workspace, sessionID)
}

// deriveDirectory validates the persisted conversation workspace and the
// evidence directory below it:
//
//   - an empty, relative or unresolvable workspace is inconsistent with a
//     Coding conversation that owns browser evidence;
//   - the evidence directory must exist;
//   - no component below the workspace may be a symbolic link;
//   - the resolved evidence path must stay inside the resolved workspace.
func deriveDirectory(workspace, sessionID string) (string, error) {
	workspace = strings.TrimSpace(workspace)
	if workspace == "" {
		return "", fmt.Errorf("会话没有已保存的工作区，无法定位浏览器证据")
	}
	if !filepath.IsAbs(workspace) {
		return "", fmt.Errorf("会话工作区必须是绝对路径")
	}
	resolvedWorkspace, err := filepath.EvalSymlinks(workspace)
	if err != nil {
		return "", fmt.Errorf("会话工作区不存在或无法解析: %w", err)
	}
	workspaceInfo, err := os.Stat(resolvedWorkspace)
	if err != nil {
		return "", fmt.Errorf("读取会话工作区状态: %w", err)
	}
	if !workspaceInfo.IsDir() {
		return "", fmt.Errorf("会话工作区不是目录: %s", resolvedWorkspace)
	}

	evidencePath := filepath.Join(resolvedWorkspace, EvidenceRelativeDir, sessionID)
	if err := verifyDirectoryChain(resolvedWorkspace, evidencePath); err != nil {
		return "", err
	}
	resolvedEvidence, err := filepath.EvalSymlinks(evidencePath)
	if err != nil {
		return "", fmt.Errorf("浏览器证据目录无法解析: %w", err)
	}
	relative, err := filepath.Rel(resolvedWorkspace, resolvedEvidence)
	if err != nil || filepath.IsAbs(relative) ||
		relative == ".." ||
		strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("浏览器证据目录逃逸了会话工作区")
	}
	evidenceInfo, err := os.Stat(resolvedEvidence)
	if err != nil {
		return "", fmt.Errorf("浏览器证据目录不存在: %w", err)
	}
	if !evidenceInfo.IsDir() {
		return "", fmt.Errorf("浏览器证据路径不是目录")
	}
	return filepath.Clean(evidencePath), nil
}

// verifyDirectoryChain requires the evidence directory and every component
// below the workspace to exist as a real directory: a symbolic link anywhere
// in the chain could point outside the conversation workspace.
func verifyDirectoryChain(resolvedWorkspace, evidencePath string) error {
	relative, err := filepath.Rel(resolvedWorkspace, evidencePath)
	if err != nil || filepath.IsAbs(relative) ||
		relative == ".." ||
		strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return fmt.Errorf("浏览器证据路径逃逸了会话工作区")
	}
	current := resolvedWorkspace
	for _, component := range strings.Split(relative, string(filepath.Separator)) {
		if component == "" || component == "." {
			continue
		}
		current = filepath.Join(current, component)
		info, err := os.Lstat(current)
		if err != nil {
			if os.IsNotExist(err) {
				return fmt.Errorf("浏览器证据目录不存在: %s", current)
			}
			return fmt.Errorf("读取浏览器证据目录状态: %w", err)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("浏览器证据目录不能是符号链接: %s", current)
		}
		if !info.IsDir() {
			return fmt.Errorf("浏览器证据路径不是目录: %s", current)
		}
	}
	return nil
}

// RevealDirectory shows directory in the platform file manager. The caller
// supplies the opener, which in production is the desktop runtime's own
// cross-platform one; tests inject a recorder.
func RevealDirectory(directory string, open func(string) error) error {
	if err := open(directory); err != nil {
		return fmt.Errorf("打开浏览器证据目录: %w", err)
	}
	return nil
}

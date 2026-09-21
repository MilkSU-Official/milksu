package engine

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/config"
)

const (
	packagedCompanionBridge    = "companion-bridge.cjs"
	developmentCompanionBridge = "sidecar/companion/run-bridge.mjs"
)

// OpenCompanionSidecar starts the independent companion process. It uses the
// isolated agent workspace so Pi does not walk a user repository, and it is
// never parked with Coding / CTF sidecars.
func OpenCompanionSidecar(
	settings config.AppSettings,
	sidecarDirectory,
	agentDir string,
) (*exec.Cmd, io.WriteCloser, io.ReadCloser, error) {
	if err := os.MkdirAll(agentDir, 0o700); err != nil {
		return nil, nil, nil, fmt.Errorf("create companion agent directory: %w", err)
	}
	workspace, err := sidecarWorkspace()
	if err != nil {
		return nil, nil, nil, err
	}
	command, err := newSidecarCommandAtWithDirectory(
		packagedCompanionBridge,
		developmentCompanionBridge,
		workspace,
		true,
		sidecarDirectory,
	)
	if err != nil {
		return nil, nil, nil, err
	}
	environment, err := sidecarEnvironment(settings)
	if err != nil {
		return nil, nil, nil, err
	}
	environment = withSidecarRuntimePath(environment, command.Path)
	environment, err = withWorkspaceTemporaryDirectory(environment, workspace)
	if err != nil {
		return nil, nil, nil, err
	}
	runtimeHome, err := sidecarRuntimeHome()
	if err != nil {
		return nil, nil, nil, err
	}
	dataDirectory := filepath.Dir(runtimeHome)
	indexPath := filepath.Join(dataDirectory, "companion", "obelisk.sqlite")
	command.Env = mergeSidecarEnvironment(environment, []string{
		"MILKSU_COMPANION_AGENT_DIR=" + agentDir,
		"MILKSU_COMPANION_INDEX_PATH=" + indexPath,
		"MILKSU_PI_SESSIONS_DIR=" + filepath.Join(runtimeHome, "pi", "sessions"),
		"MILKSU_DSH_SESSIONS_DIR=" + filepath.Join(runtimeHome, "dsh", "sessions"),
		"MILKSU_COMPANION_SESSIONS_DIR=" + filepath.Join(agentDir, "sessions"),
		"MILKSU_CONVERSATIONS_DIR=" + filepath.Join(dataDirectory, "conversations"),
	})
	command.Stderr = os.Stderr
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("open companion stdin: %w", err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		stdin.Close()
		return nil, nil, nil, fmt.Errorf("open companion stdout: %w", err)
	}
	if err := command.Start(); err != nil {
		stdin.Close()
		stdout.Close()
		return nil, nil, nil, fmt.Errorf("start companion sidecar: %w", err)
	}
	return command, stdin, stdout, nil
}

// CompanionCustomProvider is the turn-scoped custom relay definition for the
// companion process. Keys stay in this payload and never enter tool output.
//
// Companion selection is independent of the homepage ActiveProvider. Using
// ActiveProvider here dropped a personal custom-relay key whenever the
// homepage still pointed at official TokenFlux, and the sidecar then sent
// the leftover TokenFlux secret (or nothing) to the relay the companion
// actually selected.
func CompanionCustomProvider(settings config.AppSettings) map[string]any {
	name := strings.TrimSpace(settings.CompanionProvider)
	if name == "" {
		name = settings.ActiveProvider
	}
	return customProviderPayloadFor(settings, name)
}

func (s *Supervisor) HasRegisteredSession(sessionID string) bool {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.sessions[sessionID]
	return ok
}

func (s *Supervisor) SessionBusy(sessionID string) bool {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" || s == nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.busySessions[sessionID]
	return ok
}

func (s *Supervisor) SessionKernel(sessionID string) string {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" || s == nil {
		return KernelPi
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.kernelForLocked(sessionID)
}

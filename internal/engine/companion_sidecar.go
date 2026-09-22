package engine

import (
	"errors"
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

// ErrCompanionCredentialMissing means the companion turn's source has no key.
// An explicit personal or service choice is not replaced. The factory account
// route is the one exception: when that relay has no key, ResolveCompanionTurn
// adopts the main window's already configured provider instead of failing.
var ErrCompanionCredentialMissing = errors.New("companion credential missing")

// CompanionCustomProvider is the turn-scoped custom relay definition for the
// companion process. Keys stay in this payload and never enter tool output.
//
// The payload follows the turn selection. Personal and service turns use that
// provider's own key. Account turns use the account relay and do not attach
// a homepage or personal relay payload.
func CompanionCustomProvider(settings config.AppSettings) map[string]any {
	payload, err := CompanionTurnAuth(settings)
	if err != nil {
		return nil
	}
	return payload
}

// ResolveCompanionTurn is the model the companion process may call.
// A saved explicit source is kept. The factory account route stays on the
// account relay when that relay has a key. When the factory account route
// has no key, the turn uses the same provider and model the main window
// can already call, and the same key already stored for that provider.
func ResolveCompanionTurn(settings config.AppSettings) config.CompanionModelSelection {
	selection := config.ResolveCompanionModel(settings)
	if !companionFactoryAccountWithoutKey(settings, selection) {
		return selection
	}
	if adopted, ok := companionMainWindowRoute(settings); ok {
		return adopted
	}
	return selection
}

func companionFactoryAccountWithoutKey(settings config.AppSettings, selection config.CompanionModelSelection) bool {
	if selection.Source != config.ModelSourceAccount || accountRelayReady(settings) {
		return false
	}
	return selection.Provider == config.DefaultCompanionProvider &&
		selection.Model == config.DefaultCompanionModel
}

// companionMainWindowRoute is the provider and model the main window already
// uses. It reads that provider's existing key. It does not invent a source
// or copy the key into companion settings.
func companionMainWindowRoute(settings config.AppSettings) (config.CompanionModelSelection, bool) {
	providerName := strings.TrimSpace(settings.ActiveProvider)
	model := strings.TrimSpace(settings.ActiveModel)
	if providerName == "" || model == "" {
		return config.CompanionModelSelection{}, false
	}
	provider, exists := settings.Providers[providerName]
	if !exists || !provider.Enabled {
		return config.CompanionModelSelection{}, false
	}
	source := config.ModelSourcePersonal
	if provider.Custom {
		source = "service"
		if customProviderPayloadFor(settings, providerName) == nil {
			return config.CompanionModelSelection{}, false
		}
	} else if strings.TrimSpace(provider.APIKey) == "" {
		return config.CompanionModelSelection{}, false
	}
	return config.CompanionModelSelection{
		Provider: providerName,
		Model:    model,
		Source:   source,
	}, true
}

// CompanionTurnAuth resolves the credential the companion turn is allowed to
// use. A missing key is an error so the caller does not send the account
// relay secret, or an empty key, to a different relay.
func CompanionTurnAuth(settings config.AppSettings) (map[string]any, error) {
	return companionAuthFor(settings, ResolveCompanionTurn(settings))
}

func companionAuthFor(settings config.AppSettings, selection config.CompanionModelSelection) (map[string]any, error) {
	switch selection.Source {
	case config.ModelSourceAccount:
		if !accountRelayReady(settings) {
			return nil, ErrCompanionCredentialMissing
		}
		return nil, nil
	case config.ModelSourcePersonal, "service":
		name := strings.TrimSpace(selection.Provider)
		if name == "" {
			return nil, ErrCompanionCredentialMissing
		}
		provider, exists := settings.Providers[name]
		if !exists || !provider.Enabled {
			return nil, ErrCompanionCredentialMissing
		}
		if provider.Custom {
			payload := customProviderPayloadFor(settings, name)
			if payload == nil {
				return nil, ErrCompanionCredentialMissing
			}
			return payload, nil
		}
		if strings.TrimSpace(provider.APIKey) == "" {
			return nil, ErrCompanionCredentialMissing
		}
		return nil, nil
	default:
		return nil, ErrCompanionCredentialMissing
	}
}

func accountRelayReady(settings config.AppSettings) bool {
	relay := settings.Relay
	return relay != nil && relay.Enabled && strings.TrimSpace(relay.Key) != ""
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

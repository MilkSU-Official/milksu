package plugin

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const (
	stateSchema           = "milksu.plugin-state/v2"
	legacyStateSchema     = "milksu.plugin-state/v1"
	maxStateBytes         = 8 << 20
	maxPluginStorageBytes = 256 << 10
	pluginStateFile       = "state.json"
	pluginStorageDir      = "storage"
)

type persistedState struct {
	Schema          string                    `json:"schema"`
	Enabled         map[string]bool           `json:"enabled"`
	External        map[string]bool           `json:"external,omitempty"`
	Skin            map[string]skinState      `json:"skin,omitempty"`
	Storage         map[string]map[string]any `json:"storage,omitempty"`
	StorageVersions map[string]uint           `json:"storage_versions,omitempty"`
}

type skinState struct {
	BackgroundFile string                       `json:"background_file,omitempty"`
	Opacity        float64                      `json:"opacity,omitempty"`
	Blur           float64                      `json:"blur,omitempty"`
	Configured     bool                         `json:"configured,omitempty"`
	Surfaces       map[SurfaceSlot]SurfaceStyle `json:"surfaces,omitempty"`
}

func defaultState() persistedState {
	return persistedState{
		Schema: stateSchema, Enabled: map[string]bool{}, External: map[string]bool{},
		Skin: map[string]skinState{}, Storage: map[string]map[string]any{}, StorageVersions: map[string]uint{},
	}
}

func readState(path string) (persistedState, error) {
	state := defaultState()
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return state, nil
	}
	if err != nil {
		return state, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return state, fmt.Errorf("plugin state must be a regular, non-symlink file")
	}
	if info.Size() > maxStateBytes {
		return state, fmt.Errorf("plugin state is larger than %d bytes", maxStateBytes)
	}
	file, err := os.Open(path)
	if err != nil {
		return state, err
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, maxStateBytes+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil {
		return defaultState(), fmt.Errorf("decode plugin state: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return defaultState(), errors.New("plugin state contains trailing JSON data")
	}
	if state.Schema != stateSchema && state.Schema != legacyStateSchema {
		return defaultState(), fmt.Errorf("unsupported plugin state schema %q", state.Schema)
	}
	if state.Schema == legacyStateSchema {
		state.Schema = stateSchema
		for id, skin := range state.Skin {
			if skin.BackgroundFile == "" && !skin.Configured {
				continue
			}
			style := SurfaceStyle{
				Mode: SurfaceModeSolid, Solid: SurfaceSolidOriginal,
				ImageOpacity: skin.Opacity, Blur: skin.Blur,
				LightMask: SurfaceMask{Color: "#ffffff", Opacity: 0.12},
				DarkMask:  SurfaceMask{Color: "#000000", Opacity: 0.22},
			}
			if skin.BackgroundFile != "" {
				style.Mode = SurfaceModeImage
				style.AssetID = skin.BackgroundFile
			}
			skin.Surfaces = map[SurfaceSlot]SurfaceStyle{SurfaceContentWallpaper: style}
			state.Skin[id] = skin
		}
	}
	if state.Enabled == nil {
		state.Enabled = map[string]bool{}
	}
	if state.Skin == nil {
		state.Skin = map[string]skinState{}
	}
	if state.External == nil {
		state.External = map[string]bool{}
	}
	if state.Storage == nil {
		state.Storage = map[string]map[string]any{}
	}
	if state.StorageVersions == nil {
		state.StorageVersions = map[string]uint{}
	}
	for id, skin := range state.Skin {
		if skin.Surfaces == nil {
			skin.Surfaces = map[SurfaceSlot]SurfaceStyle{}
			state.Skin[id] = skin
		}
	}
	return state, nil
}

func writeState(path string, state persistedState) error {
	payload, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("encode plugin state: %w", err)
	}
	if len(payload) > maxStateBytes {
		return fmt.Errorf("plugin state is larger than %d bytes", maxStateBytes)
	}
	payload = append(payload, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create plugin state directory: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".plugin-state-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	return nil
}

// commitStateLocked publishes a prepared state snapshot without exposing it to
// readers until the durable, atomic file replacement has succeeded. Callers
// must hold r.mu for writing and must never mutate r.state in place first.
func (r *Registry) commitStateLocked(next persistedState) error {
	if err := writeState(r.statePath(), next); err != nil {
		return err
	}
	r.state = next
	return nil
}

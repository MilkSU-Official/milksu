package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

const (
	pluginCallTimeout     = 2 * time.Second
	maxRuntimeResultBytes = 1 << 20
	maxStorageValueBytes  = 64 << 10
)

var storageKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,63}$`)

type runtimeInvocation struct {
	ABI            string                     `json:"abi"`
	Name           string                     `json:"name,omitempty"`
	Input          json.RawMessage            `json:"input"`
	PluginID       string                     `json:"pluginId"`
	PluginVersion  string                     `json:"pluginVersion"`
	APIVersion     string                     `json:"apiVersion"`
	HostVersion    string                     `json:"hostVersion"`
	Capabilities   []string                   `json:"capabilities"`
	Permissions    []Permission               `json:"permissions"`
	Source         Source                     `json:"source"`
	StorageEnabled bool                       `json:"storageEnabled"`
	Storage        map[string]json.RawMessage `json:"storage"`
}

type runtimeResult struct {
	Value         json.RawMessage            `json:"value"`
	StorageWrites map[string]json.RawMessage `json:"storageWrites,omitempty"`
}

type runtimeExecutor interface {
	Invoke(context.Context, *packageRecord, runtimeInvocation) (runtimeResult, error)
}

type runtimes struct {
	lua        luaExecutor
	typescript typeScriptExecutor
}

func newRuntimeExecutor(options Options) runtimeExecutor {
	return &runtimes{
		lua: luaExecutor{},
		typescript: typeScriptExecutor{
			node:   options.NodeExecutable,
			worker: options.TypeScriptWorker,
		},
	}
}

func (r *runtimes) Invoke(ctx context.Context, record *packageRecord, request runtimeInvocation) (runtimeResult, error) {
	ctx, cancel := context.WithTimeout(ctx, pluginCallTimeout)
	defer cancel()
	switch record.manifest.Runtime.Kind {
	case RuntimeLua:
		return r.lua.Invoke(ctx, record, request)
	case RuntimeTypeScript:
		return r.typescript.Invoke(ctx, record, request)
	default:
		return runtimeResult{}, fmt.Errorf("unsupported plugin runtime %q", record.manifest.Runtime.Kind)
	}
}

func hasPermission(manifest Manifest, permission Permission) bool {
	for _, candidate := range manifest.Permissions {
		if candidate == permission {
			return true
		}
	}
	return false
}

func validateRuntimeResult(result runtimeResult, storageEnabled bool) error {
	if len(result.Value) == 0 {
		result.Value = json.RawMessage("null")
	}
	if len(result.Value) > maxRuntimeResultBytes || !json.Valid(result.Value) {
		return errors.New("plugin returned an invalid or oversized JSON value")
	}
	if len(result.StorageWrites) > 64 {
		return errors.New("plugin attempted too many storage writes")
	}
	if len(result.StorageWrites) > 0 && !storageEnabled {
		return errors.New("plugin attempted storage access without plugin.storage permission")
	}
	for key, value := range result.StorageWrites {
		if !storageKeyPattern.MatchString(strings.TrimSpace(key)) {
			return fmt.Errorf("plugin storage key %q is invalid", key)
		}
		if len(value) > maxStorageValueBytes || !json.Valid(value) {
			return fmt.Errorf("plugin storage value %q is invalid or oversized", key)
		}
	}
	if storageEnabled {
		encoded, err := json.Marshal(result.StorageWrites)
		if err != nil || len(encoded) > maxPluginStorageBytes {
			return errors.New("plugin attempted oversized aggregate storage writes")
		}
	}
	return nil
}

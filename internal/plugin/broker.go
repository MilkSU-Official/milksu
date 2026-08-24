package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

type capabilityResult struct {
	Capability string          `json:"capability"`
	Input      json.RawMessage `json:"input,omitempty"`
	Value      json.RawMessage `json:"value,omitempty"`
}

func (r *Registry) CallUI(ctx context.Context, id string, request UIRequest) (any, error) {
	record, err := r.enabledRecord(id)
	if err != nil {
		return nil, err
	}
	action := strings.TrimSpace(request.Action)
	if action == "" || len(action) > 96 {
		return nil, errors.New("plugin UI action is invalid")
	}
	input := request.Input
	if len(input) == 0 {
		input = json.RawMessage("{}")
	}
	if len(input) > maxRuntimeResultBytes || !json.Valid(input) {
		return nil, errors.New("plugin UI input is invalid or oversized")
	}
	invocation := r.runtimeInvocation(record, "call_ui", action, input)
	result, err := r.executor.Invoke(ctx, record, invocation)
	if err != nil {
		return nil, err
	}
	var capability capabilityResult
	decoder := json.NewDecoder(bytes.NewReader(result.Value))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&capability); err != nil {
		return nil, errors.New("plugin UI response must be a capability envelope")
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, errors.New("plugin UI response contains trailing data")
	}
	switch capability.Capability {
	case "ui.surface.get":
		if len(result.StorageWrites) > 0 {
			return nil, errors.New("host UI capabilities cannot include plugin storage writes")
		}
		if !hasPermission(record.manifest, PermissionUIBackground) {
			return nil, errors.New("plugin lacks ui.background permission")
		}
		return r.ActiveTheme()
	case "ui.surface.update":
		if len(result.StorageWrites) > 0 {
			return nil, errors.New("host UI capabilities cannot include plugin storage writes")
		}
		if !hasPermission(record.manifest, PermissionUIBackground) {
			return nil, errors.New("plugin lacks ui.background permission")
		}
		var update struct {
			Slot  SurfaceSlot  `json:"slot"`
			Style SurfaceStyle `json:"style"`
		}
		strict := json.NewDecoder(bytes.NewReader(capability.Input))
		strict.DisallowUnknownFields()
		if err := strict.Decode(&update); err != nil {
			return nil, errors.New("plugin surface update is invalid")
		}
		return r.UpdateSurface(record.manifest.ID, update.Slot, update.Style)
	case "ui.surface.reset":
		if len(result.StorageWrites) > 0 {
			return nil, errors.New("host UI capabilities cannot include plugin storage writes")
		}
		if !hasPermission(record.manifest, PermissionUIBackground) {
			return nil, errors.New("plugin lacks ui.background permission")
		}
		var reset struct {
			Slot SurfaceSlot `json:"slot"`
		}
		strict := json.NewDecoder(bytes.NewReader(capability.Input))
		strict.DisallowUnknownFields()
		if err := strict.Decode(&reset); err != nil {
			return nil, errors.New("plugin surface reset is invalid")
		}
		return r.ResetSurface(record.manifest.ID, reset.Slot)
	case "ui.surface.reset_all":
		if len(result.StorageWrites) > 0 {
			return nil, errors.New("host UI capabilities cannot include plugin storage writes")
		}
		if !hasPermission(record.manifest, PermissionUIBackground) {
			return nil, errors.New("plugin lacks ui.background permission")
		}
		return r.ResetAllSurfaces(record.manifest.ID)
	case "ui.background.get":
		if len(result.StorageWrites) > 0 {
			return nil, errors.New("host UI capabilities cannot include plugin storage writes")
		}
		if !hasPermission(record.manifest, PermissionUIBackground) {
			return nil, errors.New("plugin lacks ui.background permission")
		}
		return r.ActiveTheme()
	case "ui.background.update":
		if len(result.StorageWrites) > 0 {
			return nil, errors.New("host UI capabilities cannot include plugin storage writes")
		}
		if !hasPermission(record.manifest, PermissionUIBackground) {
			return nil, errors.New("plugin lacks ui.background permission")
		}
		var update struct {
			Opacity float64 `json:"opacity"`
			Blur    float64 `json:"blur"`
		}
		strict := json.NewDecoder(bytes.NewReader(capability.Input))
		strict.DisallowUnknownFields()
		if err := strict.Decode(&update); err != nil {
			return nil, errors.New("plugin background update is invalid")
		}
		return r.UpdateBackground(record.manifest.ID, update.Opacity, update.Blur)
	case "ui.background.reset":
		if len(result.StorageWrites) > 0 {
			return nil, errors.New("host UI capabilities cannot include plugin storage writes")
		}
		return r.ResetBackground(record.manifest.ID)
	case "value":
		if len(capability.Value) == 0 {
			if err := r.applyStorageWrites(record, result.StorageWrites); err != nil {
				return nil, err
			}
			return nil, nil
		}
		var value any
		if err := json.Unmarshal(capability.Value, &value); err != nil {
			return nil, errors.New("plugin returned invalid UI data")
		}
		if err := r.applyStorageWrites(record, result.StorageWrites); err != nil {
			return nil, err
		}
		return value, nil
	default:
		return nil, fmt.Errorf("plugin requested unsupported UI capability %q", capability.Capability)
	}
}

func (r *Registry) CallTool(ctx context.Context, call ToolCall, external bool) (ToolResult, error) {
	record, err := r.enabledRecord(call.PluginID)
	if err != nil {
		return ToolResult{}, err
	}
	if !hasPermission(record.manifest, PermissionAgentTools) {
		return ToolResult{}, errors.New("plugin lacks agent.tools permission")
	}
	var descriptor *ToolContribution
	for index := range record.manifest.Contributes.Tools {
		if record.manifest.Contributes.Tools[index].Name == call.ToolName {
			copyDescriptor := record.manifest.Contributes.Tools[index]
			descriptor = &copyDescriptor
			break
		}
	}
	if descriptor == nil {
		return ToolResult{}, fmt.Errorf("plugin tool %q is not declared", call.ToolName)
	}
	if external {
		r.mu.RLock()
		externalEnabled := r.state.External[record.manifest.ID]
		r.mu.RUnlock()
		if !externalEnabled || descriptor.External != ExternalRead || descriptor.Effect != ToolEffectRead {
			return ToolResult{}, errors.New("plugin tool is not available through read-only external MCP")
		}
		if !hasPermission(record.manifest, PermissionMCPExternalRead) {
			return ToolResult{}, errors.New("plugin lacks mcp.external.read permission")
		}
	}
	if err := validateToolInput(call.Input, descriptor.InputSchema); err != nil {
		return ToolResult{}, err
	}
	result, err := r.executor.Invoke(ctx, record, r.runtimeInvocation(record, "call_tool", descriptor.Name, call.Input))
	if err != nil {
		return ToolResult{}, err
	}
	if external && len(result.StorageWrites) > 0 {
		return ToolResult{}, errors.New("read-only external plugin tools cannot persist storage writes")
	}
	var value any
	if err := json.Unmarshal(result.Value, &value); err != nil {
		return ToolResult{}, errors.New("plugin tool returned invalid JSON")
	}
	if record.manifest.APIVersion == APIVersion {
		if err := validateToolInput(result.Value, descriptor.OutputSchema); err != nil {
			return ToolResult{}, fmt.Errorf("plugin tool output: %w", err)
		}
	}
	if err := r.applyStorageWrites(record, result.StorageWrites); err != nil {
		return ToolResult{}, err
	}
	return ToolResult{Content: value}, nil
}

func (r *Registry) runtimeInvocation(record *packageRecord, abi, name string, input json.RawMessage) runtimeInvocation {
	r.mu.RLock()
	storageValues := r.state.Storage[record.manifest.ID]
	storage := canonicalJSONMap(storageValues)
	r.mu.RUnlock()
	return runtimeInvocation{
		ABI: abi, Name: name, Input: append(json.RawMessage(nil), input...),
		PluginID:       record.manifest.ID,
		PluginVersion:  record.manifest.Version,
		APIVersion:     record.manifest.APIVersion,
		HostVersion:    r.options.HostVersion,
		Capabilities:   append([]string(nil), HostCapabilities...),
		Permissions:    append([]Permission(nil), record.manifest.Permissions...),
		Source:         record.source,
		StorageEnabled: hasPermission(record.manifest, PermissionStorage),
		Storage:        storage,
	}
}

func (r *Registry) applyStorageWrites(record *packageRecord, writes map[string]json.RawMessage) error {
	if len(writes) == 0 {
		return nil
	}
	if !hasPermission(record.manifest, PermissionStorage) {
		return errors.New("plugin attempted storage writes without plugin.storage permission")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.refreshStateLocked(); err != nil {
		return fmt.Errorf("refresh plugin state: %w", err)
	}
	if !r.state.Enabled[record.manifest.ID] {
		return errors.New("plugin was disabled while its call was running")
	}
	values, err := mergeStorageWrites(r.state.Storage[record.manifest.ID], writes)
	if err != nil {
		return err
	}
	next, err := clonePersistedState(r.state)
	if err != nil {
		return err
	}
	next.Storage[record.manifest.ID] = values
	return r.commitStateLocked(next)
}

package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"

	lua "github.com/yuin/gopher-lua"
)

type luaExecutor struct{}

func (luaExecutor) Invoke(ctx context.Context, record *packageRecord, request runtimeInvocation) (runtimeResult, error) {
	entry, err := securePackageFile(record.directory, record.manifest.Runtime.Entry, maxEntryBytes)
	if err != nil {
		return runtimeResult{}, err
	}
	state := lua.NewState(lua.Options{
		SkipOpenLibs: true, CallStackSize: 128,
		RegistrySize: 1024, RegistryMaxSize: 4096, RegistryGrowStep: 256,
		MinimizeStackMemory: true,
	})
	defer state.Close()
	state.SetContext(ctx)
	for _, library := range []struct {
		name string
		open lua.LGFunction
	}{
		{lua.BaseLibName, lua.OpenBase},
		{lua.StringLibName, lua.OpenString},
		{lua.TabLibName, lua.OpenTable},
		{lua.MathLibName, lua.OpenMath},
	} {
		if err := state.CallByParam(lua.P{Fn: state.NewFunction(library.open), NRet: 0, Protect: true}, lua.LString(library.name)); err != nil {
			return runtimeResult{}, fmt.Errorf("open safe Lua library %s: %w", library.name, err)
		}
	}
	for _, global := range []string{"dofile", "loadfile", "load", "loadstring", "require", "module", "collectgarbage", "print"} {
		state.SetGlobal(global, lua.LNil)
	}
	writes := map[string]json.RawMessage{}
	installLuaStorage(state, request, writes)
	payload, err := os.ReadFile(entry)
	if err != nil {
		return runtimeResult{}, fmt.Errorf("read Lua plugin: %w", err)
	}
	chunk, err := state.Load(bytes.NewReader(payload), "@"+record.manifest.ID+"/"+record.manifest.Runtime.Entry)
	if err != nil {
		return runtimeResult{}, fmt.Errorf("compile Lua plugin: %w", err)
	}
	if err := state.CallByParam(lua.P{Fn: chunk, NRet: 0, Protect: true}); err != nil {
		return runtimeResult{}, fmt.Errorf("load Lua plugin: %w", err)
	}
	pluginTable, ok := state.GetGlobal("plugin").(*lua.LTable)
	if !ok {
		return runtimeResult{}, errors.New("Lua entry must define global table plugin")
	}
	activateContext, _ := json.Marshal(map[string]any{
		"pluginId":      request.PluginID,
		"pluginVersion": request.PluginVersion,
		"apiVersion":    request.APIVersion,
		"hostVersion":   request.HostVersion,
		"capabilities":  request.Capabilities,
		"permissions":   request.Permissions,
		"source":        request.Source,
	})
	initialize, dispose := "initialize", "dispose"
	if record.manifest.APIVersion == LegacyAPIVersion {
		initialize, dispose = "activate", "deactivate"
	}
	if _, err := callLuaABI(state, pluginTable, initialize, string(activateContext)); err != nil {
		return runtimeResult{}, err
	}
	var raw string
	switch request.ABI {
	case "call_tool", "call_ui":
		raw, err = callLuaABI(state, pluginTable, request.ABI, request.Name, string(request.Input))
	case "health_check":
		raw = "null"
	case "migrate_storage":
		raw, err = callLuaABI(state, pluginTable, "migrate", string(request.Input))
	default:
		err = fmt.Errorf("unsupported plugin ABI %q", request.ABI)
	}
	_, disposeErr := callLuaABI(state, pluginTable, dispose)
	if err != nil {
		return runtimeResult{}, err
	}
	if disposeErr != nil {
		return runtimeResult{}, disposeErr
	}
	result := runtimeResult{Value: json.RawMessage(raw), StorageWrites: writes}
	if err := validateRuntimeResult(result, request.StorageEnabled); err != nil {
		return runtimeResult{}, err
	}
	return result, nil
}

func callLuaABI(state *lua.LState, table *lua.LTable, name string, arguments ...string) (string, error) {
	function := state.GetField(table, name)
	if function.Type() == lua.LTNil {
		if name == "activate" || name == "deactivate" || name == "initialize" || name == "dispose" {
			return "null", nil
		}
		return "", fmt.Errorf("Lua plugin does not implement %s", name)
	}
	values := make([]lua.LValue, 0, len(arguments))
	for _, argument := range arguments {
		values = append(values, lua.LString(argument))
	}
	if err := state.CallByParam(lua.P{Fn: function, NRet: 1, Protect: true}, values...); err != nil {
		return "", fmt.Errorf("Lua plugin %s failed: %w", name, err)
	}
	value := state.Get(-1)
	state.Pop(1)
	if value == lua.LNil {
		return "null", nil
	}
	text, ok := value.(lua.LString)
	if !ok {
		return "", fmt.Errorf("Lua plugin %s must return a JSON string", name)
	}
	return string(text), nil
}

func installLuaStorage(state *lua.LState, request runtimeInvocation, writes map[string]json.RawMessage) {
	table := state.NewTable()
	state.SetField(table, "get", state.NewFunction(func(L *lua.LState) int {
		if !request.StorageEnabled {
			L.RaiseError("plugin.storage permission is required")
			return 0
		}
		key := L.CheckString(1)
		value, ok := request.Storage[key]
		if !ok {
			L.Push(lua.LNil)
		} else {
			L.Push(lua.LString(value))
		}
		return 1
	}))
	state.SetField(table, "set", state.NewFunction(func(L *lua.LState) int {
		if !request.StorageEnabled {
			L.RaiseError("plugin.storage permission is required")
			return 0
		}
		key := L.CheckString(1)
		value := json.RawMessage(L.CheckString(2))
		if !storageKeyPattern.MatchString(key) || len(value) > maxStorageValueBytes || !json.Valid(value) {
			L.RaiseError("invalid plugin storage write")
			return 0
		}
		writes[key] = append(json.RawMessage(nil), value...)
		return 0
	}))
	state.SetGlobal("milksu", table)
}

package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLuaRuntimeOpensOnlySafeLibraries(t *testing.T) {
	record := luaTestRecord(t, `
plugin = {}
function plugin.call_tool(_name, _input)
  return '{' ..
    '"os":"' .. type(os) .. '",' ..
    '"io":"' .. type(io) .. '",' ..
    '"debug":"' .. type(debug) .. '",' ..
    '"package":"' .. type(package) .. '",' ..
    '"require":"' .. type(require) .. '",' ..
    '"load":"' .. type(load) .. '",' ..
    '"loadfile":"' .. type(loadfile) .. '",' ..
    '"dofile":"' .. type(dofile) .. '",' ..
    '"print":"' .. type(print) .. '",' ..
    '"sqrt":' .. tostring(math.sqrt(9)) .. ',' ..
    '"upper":"' .. string.upper('ok') .. '"}'
end
`)
	result, err := (luaExecutor{}).Invoke(context.Background(), record, luaTestInvocation())
	if err != nil {
		t.Fatal(err)
	}
	var value struct {
		OS, IO, Debug, Package, Require, Load, LoadFile, DoFile, Print string
		Sqrt                                                           float64 `json:"sqrt"`
		Upper                                                          string  `json:"upper"`
	}
	if err := json.Unmarshal(result.Value, &value); err != nil {
		t.Fatal(err)
	}
	for name, kind := range map[string]string{
		"os": value.OS, "io": value.IO, "debug": value.Debug, "package": value.Package,
		"require": value.Require, "load": value.Load, "loadfile": value.LoadFile,
		"dofile": value.DoFile, "print": value.Print,
	} {
		if kind != "nil" {
			t.Errorf("unsafe Lua global %s has type %q", name, kind)
		}
	}
	if value.Sqrt != 3 || value.Upper != "OK" {
		t.Fatalf("safe Lua libraries result = %#v", value)
	}
}

func TestLuaRuntimeHonorsContextDeadline(t *testing.T) {
	record := luaTestRecord(t, `
plugin = {}
function plugin.call_tool(_name, _input)
  while true do end
end
`)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err := (luaExecutor{}).Invoke(ctx, record, luaTestInvocation())
	if err == nil {
		t.Fatal("infinite Lua loop was not interrupted")
	}
	if ctx.Err() != context.DeadlineExceeded {
		t.Fatalf("context error = %v", ctx.Err())
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("Lua deadline took %s", elapsed)
	}
}

func TestLuaRuntimeRejectsInvalidAndOversizedResults(t *testing.T) {
	tests := []struct {
		name       string
		returnCode string
		want       string
	}{
		{name: "invalid json", returnCode: `return "not-json"`, want: "invalid or oversized JSON"},
		{name: "non-string", returnCode: `return {}`, want: "must return a JSON string"},
		{name: "oversized", returnCode: fmt.Sprintf(`return '"' .. string.rep('a', %d) .. '"'`, maxRuntimeResultBytes+1), want: "invalid or oversized JSON"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			record := luaTestRecord(t, "plugin = {}\nfunction plugin.call_tool(_name, _input)\n"+test.returnCode+"\nend\n")
			_, err := (luaExecutor{}).Invoke(context.Background(), record, luaTestInvocation())
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("Lua result error = %v, want substring %q", err, test.want)
			}
		})
	}
}

func TestLuaRuntimeStorageRequiresPermission(t *testing.T) {
	record := luaTestRecord(t, `
plugin = {}
function plugin.call_tool(_name, _input)
  return milksu.get("secret")
end
`)
	_, err := (luaExecutor{}).Invoke(context.Background(), record, luaTestInvocation())
	if err == nil || !strings.Contains(err.Error(), "plugin.storage permission is required") {
		t.Fatalf("Lua storage permission error = %v", err)
	}
}

func TestLuaRuntimeReturnsDisposeFailure(t *testing.T) {
	record := luaTestRecord(t, `
plugin = {}
function plugin.initialize(_context) return "null" end
function plugin.call_tool(_name, _input) return "null" end
function plugin.dispose() error("dispose failed") end
`)
	_, err := (luaExecutor{}).Invoke(context.Background(), record, luaTestInvocation())
	if err == nil || !strings.Contains(err.Error(), "dispose failed") {
		t.Fatalf("Lua dispose error = %v", err)
	}
}

func luaTestRecord(t *testing.T, source string) *packageRecord {
	t.Helper()
	directory := t.TempDir()
	entry := filepath.Join(directory, "main.lua")
	writeTestFile(t, entry, source)
	return &packageRecord{
		directory: directory,
		manifest: Manifest{
			ID: "test.lua", Name: "Lua test", Version: "1.0.0", APIVersion: APIVersion,
			Runtime: RuntimeSpec{Kind: RuntimeLua, Entry: filepath.Base(entry)},
		},
	}
}

func luaTestInvocation() runtimeInvocation {
	return runtimeInvocation{
		ABI: "call_tool", Name: "test", Input: json.RawMessage(`{}`),
		PluginID: "test.lua", StorageEnabled: false,
		Storage: map[string]json.RawMessage{},
	}
}

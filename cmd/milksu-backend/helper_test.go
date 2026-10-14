package main

import (
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

func TestDesktopHelperMethodsMatchNativeHelperSurface(t *testing.T) {
	methods := desktopHelperMethods(&App{})
	got := make([]string, 0, len(methods))
	for name, method := range methods {
		if method.source != desktopRPCSourceElectronHost {
			t.Errorf("%s source = %q, want electron_host", name, method.source)
		}
		methodType := reflect.TypeOf(method.function)
		if methodType == nil || methodType.Kind() != reflect.Func {
			t.Errorf("desktop helper method %s is not bound to a function", name)
		}
		got = append(got, name)
	}
	sort.Strings(got)
	want := []string{
		"ClosePty",
		"ComputerUseAccessibilityStatus",
		"ComputerUseHostExecutable",
		"ComputerUseLinuxDesktop",
		"ComputerUseListWindows",
		"ComputerUseRequestAccessibility",
		"ComputerUseRequestScreenRecording",
		"ComputerUseSigningStatus",
		"ComputerUseStartPortal",
		"ComputerUseStopPortal",
		"DeletePlatformSecret",
		"GetPlatformSecret",
		"OpenPty",
		"PtyResize",
		"PtyWrite",
		"RunLuaPlugin",
		"SetPlatformSecret",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("helper method registry drift\n got: %v\nwant: %v", got, want)
	}
	for _, name := range []string{
		"ListConversations",
		"SendMessage",
		"GetSettings",
		"ExportSidecarEnvironment",
		"PutManagedSecret",
		"GenerateConversationTitle",
	} {
		if _, ok := methods[name]; ok {
			t.Errorf("native helper must not expose %s", name)
		}
	}
}

func TestNewNativeHelperDoesNotWriteLifespan(t *testing.T) {
	home := t.TempDir()
	t.Setenv("MILKSU_HOME", home)
	helper := newNativeHelper(nil)
	if helper == nil {
		t.Fatal("newNativeHelper returned nil")
	}
	if helper.ctx == nil {
		t.Fatal("helper ctx is nil")
	}
	if helper.ptyPool == nil {
		t.Fatal("helper ptyPool is nil")
	}
	path := filepath.Join(home, "data", "runtime", "lifespan.json")
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("lifespan.json path %s: %v", path, err)
	}
	helper.helperShutdown()
}

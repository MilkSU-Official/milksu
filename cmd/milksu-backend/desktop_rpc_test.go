package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"
)

func TestDesktopAppMethodsMatchRendererBindings(t *testing.T) {
	sourcePath := filepath.Join("..", "..", "app", "src", "desktop.ts")
	source, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatalf("read %s: %v", sourcePath, err)
	}
	bindingsStart := strings.Index(string(source), "interface DesktopAppBindings")
	bindingsEnd := strings.Index(string(source), "declare global")
	if bindingsStart < 0 || bindingsEnd <= bindingsStart {
		t.Fatal("DesktopAppBindings boundary not found")
	}
	bindingPattern := regexp.MustCompile(`(?m)^  ([A-Z][A-Za-z0-9]+)\(`)
	electronMethods := map[string]bool{
		"GetAccountStatus":  true,
		"StartAccountLogin": true,
		"LogoutAccount":     true,
		"GetUpdateStatus":   true,
		"CheckForUpdates":   true,
		"DownloadUpdate":    true,
		"InstallUpdate":     true,
		"GetBuildTracking":  true,
	}
	wantRendererSet := map[string]bool{
		"ListPlugins":             true,
		"SetPluginEnabled":        true,
		"GetPluginSettingsScript": true,
		"GetActivePluginTheme":    true,
		"CallPluginUI":            true,
		"ChoosePluginBackground":  true,
	}
	for _, match := range bindingPattern.FindAllStringSubmatch(
		string(source[bindingsStart:bindingsEnd]),
		-1,
	) {
		if !electronMethods[match[1]] {
			wantRendererSet[match[1]] = true
		}
	}
	wantRenderer := make([]string, 0, len(wantRendererSet))
	for name := range wantRendererSet {
		wantRenderer = append(wantRenderer, name)
	}

	methods := desktopAppMethods(&App{})
	gotRenderer := make([]string, 0)
	gotElectronHost := make([]string, 0)
	for name, method := range methods {
		methodType := reflect.TypeOf(method.function)
		if methodType == nil || methodType.Kind() != reflect.Func {
			t.Errorf("desktop method %s is not bound to a function", name)
		}
		switch method.source {
		case desktopRPCSourceRenderer:
			gotRenderer = append(gotRenderer, name)
		case desktopRPCSourceElectronHost:
			gotElectronHost = append(gotElectronHost, name)
		default:
			t.Errorf("desktop method %s has unknown source %q", name, method.source)
		}
	}
	sort.Strings(wantRenderer)
	sort.Strings(gotRenderer)
	sort.Strings(gotElectronHost)
	if !reflect.DeepEqual(gotRenderer, wantRenderer) {
		t.Fatalf("renderer desktop method registry drift\n got: %v\nwant: %v", gotRenderer, wantRenderer)
	}
	wantElectronHost := []string{"ClearAccountModelCredential", "SetAccountModelCredential"}
	if !reflect.DeepEqual(gotElectronHost, wantElectronHost) {
		t.Fatalf("Electron host method registry drift: got %v, want %v", gotElectronHost, wantElectronHost)
	}
}

func TestExportedAppMethodsHaveExplicitRPCDisposition(t *testing.T) {
	registered := desktopAppMethods(&App{})
	appType := reflect.TypeOf((*App)(nil))
	unregistered := make([]string, 0)
	for index := 0; index < appType.NumMethod(); index++ {
		name := appType.Method(index).Name
		if _, ok := registered[name]; !ok {
			unregistered = append(unregistered, name)
		}
	}
	sort.Strings(unregistered)
	want := []string{"Shutdown", "Startup"}
	if !reflect.DeepEqual(unregistered, want) {
		t.Fatalf(
			"exported App methods need an explicit RPC binding or lifecycle disposition: got %v, want %v",
			unregistered,
			want,
		)
	}
}

func TestInvokeAppMethodEnforcesSourceDomains(t *testing.T) {
	app := &App{}
	tests := []struct {
		name   string
		source desktopRPCSource
		method string
		want   string
	}{
		{
			name:   "renderer cannot set account credential",
			source: desktopRPCSourceRenderer,
			method: "SetAccountModelCredential",
			want:   "unavailable to renderer",
		},
		{
			name:   "renderer cannot clear account credential",
			source: desktopRPCSourceRenderer,
			method: "ClearAccountModelCredential",
			want:   "unavailable to renderer",
		},
		{
			name:   "host cannot claim renderer surface",
			source: desktopRPCSourceElectronHost,
			method: "GetSettings",
			want:   "unavailable to electron_host",
		},
		{
			name:   "missing source is rejected",
			source: "",
			method: "GetSettings",
			want:   "unsupported desktop RPC source",
		},
		{
			name:   "forged source is rejected",
			source: "renderer_with_host_privileges",
			method: "GetSettings",
			want:   "unsupported desktop RPC source",
		},
		{
			name:   "lifecycle method is not exposed",
			source: desktopRPCSourceRenderer,
			method: "Startup",
			want:   "unsupported desktop method",
		},
		{
			name:   "unknown method is not exposed",
			source: desktopRPCSourceRenderer,
			method: "DefinitelyNotAnAppMethod",
			want:   "unsupported desktop method",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result, err := invokeAppMethod(app, test.source, test.method, nil)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("invokeAppMethod() result=%v err=%v, want error containing %q", result, err, test.want)
			}
		})
	}
}

func TestInvokeAppMethodAllowsRendererBinding(t *testing.T) {
	result, err := invokeAppMethod(
		&App{},
		desktopRPCSourceRenderer,
		"GetStartupRecoveryStatus",
		nil,
	)
	if err != nil {
		t.Fatalf("invoke renderer method: %v", err)
	}
	if result == nil {
		t.Fatal("renderer method returned an unexpected nil result")
	}
}

func TestInvokeDesktopMethodDecodesExplicitFunctionValue(t *testing.T) {
	result, err := invokeDesktopMethod(
		"Example",
		func(label string, count int, enabled bool) (map[string]any, error) {
			return map[string]any{
				"label":   label,
				"count":   count,
				"enabled": enabled,
			}, nil
		},
		[]json.RawMessage{
			json.RawMessage(`"MilkSU"`),
			json.RawMessage(`3`),
			json.RawMessage(`true`),
		},
	)
	if err != nil {
		t.Fatalf("invoke explicit function: %v", err)
	}
	want := map[string]any{"label": "MilkSU", "count": 3, "enabled": true}
	if !reflect.DeepEqual(result, want) {
		t.Fatalf("invoke explicit function result=%#v, want %#v", result, want)
	}
}

func TestInvokeDesktopMethodRejectsMalformedCalls(t *testing.T) {
	tests := []struct {
		name     string
		function any
		args     []json.RawMessage
		want     string
	}{
		{
			name:     "non-function binding",
			function: 42,
			want:     "invalid binding",
		},
		{
			name:     "wrong argument count",
			function: func(string) {},
			want:     "expects 1 arguments, received 0",
		},
		{
			name:     "invalid argument JSON",
			function: func(string) {},
			args:     []json.RawMessage{json.RawMessage(`{`)},
			want:     "decode argument 0",
		},
		{
			name: "panic is contained",
			function: func() {
				panic("sensitive panic")
			},
			want: "desktop method panic is contained failed",
		},
		{
			name:     "unsupported result shape",
			function: func() (int, string) { return 1, "two" },
			want:     "unsupported result shape",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result, err := invokeDesktopMethod(test.name, test.function, test.args)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("invokeDesktopMethod() result=%v err=%v, want error containing %q", result, err, test.want)
			}
		})
	}
}

func TestInvokeDesktopMethodReturnsBoundError(t *testing.T) {
	want := errors.New("bound method failed")
	result, err := invokeDesktopMethod("Failure", func() error { return want }, nil)
	if result != nil || !errors.Is(err, want) {
		t.Fatalf("invokeDesktopMethod() result=%v err=%v, want nil and %v", result, err, want)
	}
}

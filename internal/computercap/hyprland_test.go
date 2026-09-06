package computercap

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/hostpath"
)

type fakeHyprlandPointer struct {
	clicks  [][2]float64
	scrolls []string
	closed  bool
}

func (pointer *fakeHyprlandPointer) Click(x, y float64, _, _ int) error {
	pointer.clicks = append(pointer.clicks, [2]float64{x, y})
	return nil
}

func (pointer *fakeHyprlandPointer) Scroll(direction string, _ int) error {
	pointer.scrolls = append(pointer.scrolls, direction)
	return nil
}

func (pointer *fakeHyprlandPointer) Close() error {
	pointer.closed = true
	return nil
}

func TestLinuxHyprlandAvailableWithOwnBackend(t *testing.T) {
	host := &fakePortal{}
	manager := New(Options{
		GOOS:           "linux",
		GrantDirectory: t.TempDir(),
		LinuxPortal:    func() bool { return false },
		LinuxHyprland:  func() bool { return true },
		LinuxHyprlandTools: func() error {
			return nil
		},
		NewHyprland: func() (PortalSession, error) { return host, nil },
		LinuxEnv: func(key string) string {
			if key == "HYPRLAND_INSTANCE_SIGNATURE" {
				return "abc"
			}
			if key == "XDG_CURRENT_DESKTOP" {
				return "Hyprland"
			}
			if key == "XDG_SESSION_TYPE" {
				return "wayland"
			}
			return ""
		},
		PermissionProbe: func(bool) Permissions { return Permissions{} },
		PermissionOpen:  func(PermissionKind) {},
		SigningProbe:    func() SigningStatus { return SigningStatus{} },
	})
	defer manager.Close()
	status := manager.Status()
	if !status.Available {
		t.Fatalf("Hyprland must be available: %#v", status)
	}
	if status.Signing.Signature != linuxHyprlandSignature {
		t.Fatalf("signing = %#v", status.Signing)
	}
	if strings.Contains(status.Problem, "暂不可用") {
		t.Fatalf("Hyprland is still forced-unavailable: %q", status.Problem)
	}
	targets, err := manager.Targets()
	if err != nil || len(targets) != 1 || targets[0].BundleID != linuxHyprlandBundleID {
		t.Fatalf("targets = %#v %v", targets, err)
	}
	if targets[0].PID == linuxPortalSyntheticPID {
		t.Fatal("Hyprland target reused the GNOME portal PID")
	}
}

func TestLinuxPortalPathUnchangedOnGNOME(t *testing.T) {
	portal := &fakePortal{}
	manager := New(Options{
		GOOS:           "linux",
		GrantDirectory: t.TempDir(),
		LinuxPortal:    func() bool { return true },
		LinuxHyprland:  func() bool { return false },
		NewPortal:      func() (PortalSession, error) { return portal, nil },
		LinuxEnv: func(key string) string {
			if key == "XDG_CURRENT_DESKTOP" {
				return "ubuntu:GNOME"
			}
			if key == "XDG_SESSION_TYPE" {
				return "wayland"
			}
			return ""
		},
		PermissionProbe: func(bool) Permissions { return Permissions{} },
		SigningProbe:    func() SigningStatus { return SigningStatus{} },
	})
	defer manager.Close()
	status := manager.Status()
	if !status.Available || status.Signing.Signature != linuxPortalSignature {
		t.Fatalf("GNOME portal path changed: %#v", status)
	}
	targets, err := manager.Targets()
	if err != nil || targets[0].BundleID != linuxPortalBundleID {
		t.Fatalf("GNOME targets = %#v %v", targets, err)
	}
}

func TestLinuxKDEAndXorgStayUnavailable(t *testing.T) {
	cases := []struct {
		name string
		env  func(string) string
	}{
		{
			name: "kde-wayland",
			env: func(key string) string {
				switch key {
				case "XDG_CURRENT_DESKTOP":
					return "KDE"
				case "XDG_SESSION_TYPE":
					return "wayland"
				default:
					return ""
				}
			},
		},
		{
			name: "xorg",
			env: func(key string) string {
				switch key {
				case "XDG_CURRENT_DESKTOP":
					return "ubuntu:GNOME"
				case "XDG_SESSION_TYPE":
					return "x11"
				default:
					return ""
				}
			},
		},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			manager := New(Options{
				GOOS:            "linux",
				GrantDirectory:  t.TempDir(),
				LinuxPortal:     func() bool { return false },
				LinuxHyprland:   func() bool { return false },
				LinuxEnv:        test.env,
				PermissionProbe: func(bool) Permissions { return Permissions{} },
				SigningProbe:    func() SigningStatus { return SigningStatus{} },
			})
			defer manager.Close()
			status := manager.Status()
			if status.Available || status.Phase != "unavailable" {
				t.Fatalf("expected unavailable: %#v", status)
			}
			if strings.Contains(status.Problem, "暂不可用") && strings.Contains(status.Problem, "Hyprland") {
				t.Fatalf("non-Hyprland desktop used Hyprland unavailable copy: %q", status.Problem)
			}
			if _, err := manager.Targets(); err == nil {
				t.Fatal("targets must fail")
			}
		})
	}
}

func TestLinuxHyprlandMissingToolsNamesPackages(t *testing.T) {
	manager := New(Options{
		GOOS:          "linux",
		LinuxPortal:   func() bool { return false },
		LinuxHyprland: func() bool { return true },
		LinuxHyprlandTools: func() error {
			return errors.New(linuxHyprlandToolsProblem([]string{"grim", "wtype"}))
		},
		LinuxEnv: func(key string) string {
			if key == "HYPRLAND_INSTANCE_SIGNATURE" {
				return "abc"
			}
			return ""
		},
		PermissionProbe: func(bool) Permissions { return Permissions{} },
		SigningProbe:    func() SigningStatus { return SigningStatus{} },
	})
	defer manager.Close()
	status := manager.Status()
	if status.Available {
		t.Fatalf("missing tools must not be available: %#v", status)
	}
	if status.Signing.Signature != linuxHyprlandSignature {
		t.Fatalf("missing-tools status should still name the Hyprland backend: %#v", status)
	}
	if !strings.Contains(status.Problem, "grim") || !strings.Contains(status.Problem, "wtype") {
		t.Fatalf("problem = %q", status.Problem)
	}
	if strings.Contains(status.Problem, "暂不可用") {
		t.Fatalf("missing tools still uses the old unavailable copy: %q", status.Problem)
	}
	prepared, err := manager.Prepare(t.Context(), PrepareOptions{})
	if err == nil || prepared.Ready {
		t.Fatalf("prepare = %#v %v", prepared, err)
	}
	if !strings.Contains(prepared.NextStep, "pacman") || strings.Contains(prepared.NextStep, "暂不可用") {
		t.Fatalf("nextStep = %q", prepared.NextStep)
	}
	if strings.Contains(strings.ToLower(prepared.NextStep+prepared.Problem), "xinput") == false {
		t.Fatalf("prepare should mention that xinput is not used: %#v", prepared)
	}
}

func TestLinuxHyprlandPrepareReady(t *testing.T) {
	manager := New(Options{
		GOOS:               "linux",
		LinuxPortal:        func() bool { return false },
		LinuxHyprland:      func() bool { return true },
		LinuxHyprlandTools: func() error { return nil },
		PermissionProbe:    func(bool) Permissions { return Permissions{} },
		SigningProbe:       func() SigningStatus { return SigningStatus{} },
	})
	defer manager.Close()
	prepared, err := manager.Prepare(t.Context(), PrepareOptions{})
	if err != nil || !prepared.Ready || prepared.Source != "hyprland-compositor" {
		t.Fatalf("prepare = %#v %v", prepared, err)
	}
	if strings.Contains(prepared.NextStep, "GNOME Portal") == false &&
		strings.Contains(prepared.NextStep, "不是 GNOME Portal") == false {
		t.Fatalf("prepare must say Hyprland is not Portal: %q", prepared.NextStep)
	}
}

func TestLinuxHyprlandNeverCallsXinput(t *testing.T) {
	var names []string
	session := &hyprlandSession{
		lookPath: func(name string) (string, error) {
			names = append(names, name)
			if forbiddenHostTool(name) {
				t.Fatalf("lookPath requested forbidden tool %q", name)
			}
			return "/usr/bin/" + name, nil
		},
		run: func(_ context.Context, name string, args ...string) ([]byte, error) {
			names = append(names, name)
			if forbiddenHostTool(name) {
				t.Fatalf("run requested forbidden tool %q", name)
			}
			for _, arg := range args {
				if forbiddenHostTool(arg) || strings.Contains(arg, "xinput") {
					t.Fatalf("run args used forbidden tool %q", arg)
				}
			}
			if strings.HasSuffix(name, "hyprctl") && len(args) >= 2 && args[0] == "-j" {
				return []byte(`[{"x":0,"y":0,"width":1920,"height":1080,"focused":true}]`), nil
			}
			return nil, nil
		},
		connectPointer: func() (hyprlandPointer, error) {
			return &fakeHyprlandPointer{}, nil
		},
		getenv: func(string) string { return "" },
	}
	if err := session.Start(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := session.Type("hi"); err != nil {
		t.Fatal(err)
	}
	if err := session.Close(); err != nil {
		t.Fatal(err)
	}
	for _, name := range names {
		base := filepath.Base(name)
		if forbiddenHostTool(base) || base == "xinput" {
			t.Fatalf("Hyprland session touched %q", name)
		}
	}
}

func TestLinuxHyprlandSessionScreenshotUsesHostpath(t *testing.T) {
	runtimeDir := t.TempDir()
	t.Setenv("XDG_RUNTIME_DIR", runtimeDir)
	pointer := &fakeHyprlandPointer{}
	var grimPath string
	session := &hyprlandSession{
		lookPath: func(name string) (string, error) { return "/bin/" + name, nil },
		run: func(_ context.Context, name string, args ...string) ([]byte, error) {
			if strings.HasSuffix(name, "grim") {
				grimPath = args[len(args)-1]
				png := []byte{
					0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
					0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
					0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
					0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
					0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
					0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
					0x00, 0x00, 0x03, 0x00, 0x01, 0x3b, 0x6d, 0xa8,
					0xdb, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
					0x44, 0xae, 0x42, 0x60, 0x82,
				}
				if err := os.WriteFile(grimPath, png, 0o600); err != nil {
					return nil, err
				}
			}
			return nil, nil
		},
		connectPointer: func() (hyprlandPointer, error) { return pointer, nil },
		getenv:         os.Getenv,
	}
	if err := session.Start(t.Context()); err != nil {
		t.Fatal(err)
	}
	png, width, height, err := session.Screenshot(t.Context())
	if err != nil || width != 1 || height != 1 || len(png) == 0 {
		t.Fatalf("screenshot = %d %d %v", width, height, err)
	}
	if grimPath == "" {
		t.Fatal("grim was not invoked")
	}
	if !strings.HasPrefix(grimPath, hostpath.EphemeralRoot()) {
		t.Fatalf("grim path %q is not under hostpath ephemeral root %q", grimPath, hostpath.EphemeralRoot())
	}
	if strings.HasPrefix(grimPath, "/tmp/milksu-") || strings.Contains(grimPath, "/private/tmp/") {
		t.Fatalf("grim path hardcodes tmp: %q", grimPath)
	}
	if err := session.Click(12, 34); err != nil {
		t.Fatal(err)
	}
	if len(pointer.clicks) != 1 || pointer.clicks[0] != [2]float64{12, 34} {
		t.Fatalf("clicks = %#v", pointer.clicks)
	}
}

func TestLinuxHyprlandStartServesClickAndType(t *testing.T) {
	host := &fakePortal{}
	manager := New(Options{
		GOOS:               "linux",
		GrantDirectory:     t.TempDir(),
		LinuxPortal:        func() bool { return false },
		LinuxHyprland:      func() bool { return true },
		LinuxHyprlandTools: func() error { return nil },
		NewHyprland:        func() (PortalSession, error) { return host, nil },
		PermissionProbe:    func(bool) Permissions { return Permissions{} },
		SigningProbe:       func() SigningStatus { return SigningStatus{} },
	})
	defer manager.Close()
	started, err := manager.Start(t.Context(), "conv_linux_hyprland_1", TargetSelection{})
	if err != nil {
		t.Fatal(err)
	}
	if started.Phase != "ready" || started.Signing.Signature != linuxHyprlandSignature || !host.started {
		t.Fatalf("start = %#v started=%v", started, host.started)
	}
	descriptor, ok := manager.Descriptor("conv_linux_hyprland_1")
	if !ok {
		t.Fatal("missing descriptor")
	}
	conn, err := net.DialTimeout("unix", descriptor.SocketPath, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Write([]byte(`{"tool":"click","args":{"x":8,"y":9}}` + "\n")); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 4096)
	n, err := conn.Read(buf)
	_ = conn.Close()
	if err != nil {
		t.Fatal(err)
	}
	var reply portalReply
	if err := json.Unmarshal(buf[:n], &reply); err != nil {
		t.Fatal(err)
	}
	if reply.Error != "" || len(host.clicks) != 1 {
		t.Fatalf("click = %#v host=%#v", reply, host)
	}
	stopped, err := manager.Stop("conv_linux_hyprland_1")
	if err != nil || stopped.Enabled || !host.closed {
		t.Fatalf("stop = %#v closed=%v err=%v", stopped, host.closed, err)
	}
}

func TestLinuxHyprlandSessionCloseDestroysPointer(t *testing.T) {
	pointer := &fakeHyprlandPointer{}
	session := &hyprlandSession{
		lookPath: func(name string) (string, error) { return "/bin/" + name, nil },
		run: func(_ context.Context, name string, args ...string) ([]byte, error) {
			return nil, nil
		},
		connectPointer: func() (hyprlandPointer, error) { return pointer, nil },
		getenv:         func(string) string { return "" },
	}
	if err := session.Start(t.Context()); err != nil {
		t.Fatal(err)
	}
	if session.pointer == nil {
		t.Fatal("start did not attach a pointer")
	}
	if err := session.Close(); err != nil {
		t.Fatal(err)
	}
	if !pointer.closed {
		t.Fatal("stop left the virtual pointer alive")
	}
	if session.pointer != nil || session.started {
		t.Fatalf("session still holds injection state: %#v", session)
	}
}

func TestLinuxHyprlandRejectsWindowScopeSelection(t *testing.T) {
	manager := New(Options{
		GOOS:               "linux",
		GrantDirectory:     t.TempDir(),
		LinuxPortal:        func() bool { return false },
		LinuxHyprland:      func() bool { return true },
		LinuxHyprlandTools: func() error { return nil },
		NewHyprland:        func() (PortalSession, error) { return &fakePortal{}, nil },
		PermissionProbe:    func(bool) Permissions { return Permissions{} },
		SigningProbe:       func() SigningStatus { return SigningStatus{} },
	})
	defer manager.Close()
	_, err := manager.Start(t.Context(), "conv_linux_hyprland_win", TargetSelection{PID: 99, WindowID: 7})
	if err == nil || !strings.Contains(err.Error(), "不是单个窗口") {
		t.Fatalf("window-scope error = %v", err)
	}
}

func TestForbiddenHostToolRejectsXinput(t *testing.T) {
	for _, name := range []string{"xinput", "/usr/bin/xinput", "ydotool", "libuinput-helper"} {
		if !forbiddenHostTool(name) {
			t.Fatalf("%q must be forbidden", name)
		}
	}
	for _, name := range []string{"hyprctl", "grim", "wtype"} {
		if forbiddenHostTool(name) {
			t.Fatalf("%q must stay allowed", name)
		}
	}
}

func TestParseHyprlandMonitorExtent(t *testing.T) {
	width, height, ok := parseHyprlandMonitorExtent([]byte(`[
		{"x":0,"y":0,"width":1920,"height":1080},
		{"x":1920,"y":0,"width":1280,"height":1024}
	]`))
	if !ok || width != 3200 || height != 1080 {
		t.Fatalf("extent = %d %d ok=%v", width, height, ok)
	}
}

func TestWaylandRequestEncoding(t *testing.T) {
	payload := encodeGetRegistry(1, 2)
	if len(payload) != 12 {
		t.Fatalf("get_registry size = %d", len(payload))
	}
	if binary.LittleEndian.Uint32(payload[0:4]) != 1 {
		t.Fatalf("object id = %d", binary.LittleEndian.Uint32(payload[0:4]))
	}
	word := binary.LittleEndian.Uint32(payload[4:8])
	if word&0xffff != wlDisplayGetRegistry {
		t.Fatalf("opcode = %d", word&0xffff)
	}
	if word>>16 != 12 {
		t.Fatalf("size = %d", word>>16)
	}
	click := encodePointerButton(5, linuxButtonLeftHypr, 1)
	objectID, opcode, body, err := readWaylandMessage(bytes.NewReader(click))
	if err != nil || objectID != 5 || opcode != virtualPointerButton {
		t.Fatalf("button message = %d %d %v", objectID, opcode, err)
	}
	if binary.LittleEndian.Uint32(body[4:8]) != linuxButtonLeftHypr {
		t.Fatalf("button = %d", binary.LittleEndian.Uint32(body[4:8]))
	}
}

func TestHyprlandWaylandSocketUsesRuntimeDir(t *testing.T) {
	path, err := hyprlandWaylandSocket(func(key string) string {
		if key == "XDG_RUNTIME_DIR" {
			return "/run/user/1000"
		}
		if key == "WAYLAND_DISPLAY" {
			return "wayland-2"
		}
		return ""
	})
	if err != nil {
		t.Fatal(err)
	}
	if path != "/run/user/1000/wayland-2" {
		t.Fatalf("socket = %q", path)
	}
	if strings.HasPrefix(path, "/tmp/") {
		t.Fatalf("wayland socket used /tmp: %q", path)
	}
}

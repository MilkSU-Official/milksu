package computercap

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net"
	"os"
	"strings"
	"testing"
	"time"
)

type fakePortal struct {
	started bool
	closed  bool
	clicks  [][2]float64
	typed   string
	keys    []string
	scrolls []string
}

func (portal *fakePortal) Start(context.Context) error { portal.started = true; return nil }
func (portal *fakePortal) Screenshot(context.Context) ([]byte, int, int, error) {
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
	return png, 1, 1, nil
}
func (portal *fakePortal) Click(x, y float64) error {
	portal.clicks = append(portal.clicks, [2]float64{x, y})
	return nil
}
func (portal *fakePortal) Type(text string) error { portal.typed += text; return nil }
func (portal *fakePortal) Key(name string, _ []string) error {
	portal.keys = append(portal.keys, name)
	return nil
}
func (portal *fakePortal) Scroll(direction string, amount int) error {
	portal.scrolls = append(portal.scrolls, direction)
	_ = amount
	return nil
}
func (portal *fakePortal) Close() error { portal.closed = true; return nil }

func TestLinuxPortalUnavailableOffGNOME(t *testing.T) {
	manager := New(Options{
		GOOS:           "linux",
		GrantDirectory: t.TempDir(),
		LinuxPortal:    func() bool { return false },
		LinuxEnv: func(key string) string {
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
	if status.Available {
		t.Fatalf("Hyprland must stay unavailable: %#v", status)
	}
	if !strings.Contains(status.Problem, "Hyprland") {
		t.Fatalf("problem = %q", status.Problem)
	}
}

func TestLinuxPortalStartServesScreenshotAndClick(t *testing.T) {
	portal := &fakePortal{}
	manager := New(Options{
		GOOS:           "linux",
		GrantDirectory: t.TempDir(),
		LinuxPortal:    func() bool { return true },
		NewPortal:      func() (PortalSession, error) { return portal, nil },
		PermissionProbe: func(bool) Permissions {
			return Permissions{Accessibility: true, ScreenRecording: true}
		},
		PermissionOpen: func(PermissionKind) {},
		SigningProbe:   func() SigningStatus { return SigningStatus{} },
	})
	defer manager.Close()
	status := manager.Status()
	if !status.Available {
		t.Fatalf("GNOME portal should be available: %#v", status)
	}
	if status.Signing.Signature != linuxPortalSignature {
		t.Fatalf("signing = %#v", status.Signing)
	}
	targets, err := manager.Targets()
	if err != nil || len(targets) != 1 || targets[0].BundleID != linuxPortalBundleID {
		t.Fatalf("targets = %#v %v", targets, err)
	}
	started, err := manager.Start(t.Context(), "conv_linux_portal_1", TargetSelection{})
	if err != nil {
		t.Fatal(err)
	}
	if started.Phase != "ready" || !portal.started {
		t.Fatalf("start = %#v started=%v", started, portal.started)
	}
	descriptor, ok := manager.Descriptor("conv_linux_portal_1")
	if !ok {
		t.Fatal("missing descriptor")
	}
	conn, err := net.DialTimeout("unix", descriptor.SocketPath, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Write([]byte(`{"tool":"get_window_state","args":{"include_screenshot":true}}` + "\n")); err != nil {
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
	if reply.Error != "" || reply.Result["scope"] != "display" {
		t.Fatalf("observe = %#v", reply)
	}
	if _, err := base64.StdEncoding.DecodeString(reply.Result["screenshot_png_b64"].(string)); err != nil {
		t.Fatal(err)
	}
	conn, err = net.DialTimeout("unix", descriptor.SocketPath, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Write([]byte(`{"tool":"click","args":{"x":12,"y":34}}` + "\n")); err != nil {
		t.Fatal(err)
	}
	n, err = conn.Read(buf)
	_ = conn.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(buf[:n], &reply); err != nil {
		t.Fatal(err)
	}
	if reply.Error != "" || len(portal.clicks) != 1 || portal.clicks[0] != [2]float64{12, 34} {
		t.Fatalf("click = %#v portal=%#v", reply, portal)
	}
	conn, err = net.DialTimeout("unix", descriptor.SocketPath, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Write([]byte(`{"tool":"type_text","args":{"text":"hi"}}` + "\n")); err != nil {
		t.Fatal(err)
	}
	n, err = conn.Read(buf)
	_ = conn.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(buf[:n], &reply); err != nil {
		t.Fatal(err)
	}
	if reply.Error != "" || portal.typed != "hi" {
		t.Fatalf("type = %#v portal=%#v", reply, portal)
	}
	socketPath := descriptor.SocketPath
	stopped, err := manager.Stop("conv_linux_portal_1")
	if err != nil {
		t.Fatal(err)
	}
	if stopped.Enabled || !portal.closed {
		t.Fatalf("stop = %#v closed=%v", stopped, portal.closed)
	}
	if _, err := os.Stat(socketPath); !os.IsNotExist(err) {
		t.Fatalf("portal socket still present: %v", err)
	}
}

func TestLinuxGnomeWaylandDetection(t *testing.T) {
	if !linuxGnomeWayland(func(key string) string {
		switch key {
		case "XDG_SESSION_TYPE":
			return "wayland"
		case "XDG_CURRENT_DESKTOP":
			return "ubuntu:GNOME"
		default:
			return ""
		}
	}) {
		t.Fatal("expected GNOME Wayland")
	}
	if linuxGnomeWayland(func(key string) string {
		if key == "HYPRLAND_INSTANCE_SIGNATURE" {
			return "abc"
		}
		if key == "XDG_SESSION_TYPE" {
			return "wayland"
		}
		if key == "XDG_CURRENT_DESKTOP" {
			return "Hyprland"
		}
		return ""
	}) {
		t.Fatal("Hyprland is not GNOME")
	}
}

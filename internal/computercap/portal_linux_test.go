//go:build linux

package computercap

import (
	"testing"

	"github.com/godbus/dbus/v5"
)

func TestVariantObjectPathAcceptsPathOrString(t *testing.T) {
	path, ok := variantObjectPath(dbus.MakeVariant(dbus.ObjectPath("/portal/session")))
	if !ok || path != "/portal/session" {
		t.Fatalf("object path = %q ok=%v", path, ok)
	}
	path, ok = variantObjectPath(dbus.MakeVariant("/portal/session"))
	if !ok || path != "/portal/session" {
		t.Fatalf("string path = %q ok=%v", path, ok)
	}
}

func TestFirstPortalStreamReadsNodeID(t *testing.T) {
	id := firstPortalStream(map[string]dbus.Variant{
		"streams": dbus.MakeVariant([]any{[]any{uint32(42), map[string]dbus.Variant{}}}),
	})
	if id != 42 {
		t.Fatalf("stream = %d", id)
	}
}

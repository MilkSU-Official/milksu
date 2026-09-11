package plugin

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"path/filepath"
	"strings"
	"testing"
)

func TestInspectBackgroundAcceptsDecodedImageMagicAndDimensions(t *testing.T) {
	var payload bytes.Buffer
	if err := png.Encode(&payload, image.NewNRGBA(image.Rect(0, 0, 2, 3))); err != nil {
		t.Fatal(err)
	}
	mime, extension, dimensions, err := inspectBackground(payload.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if mime != "image/png" || extension != ".png" || dimensions != image.Pt(2, 3) {
		t.Fatalf("PNG inspection = mime %q, extension %q, dimensions %v", mime, extension, dimensions)
	}
}

func TestInspectBackgroundRejectsForgedOrUnsupportedMagic(t *testing.T) {
	tests := []struct {
		name    string
		payload []byte
	}{
		{name: "forged png", payload: append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 32)...)},
		{name: "text", payload: []byte("not an image")},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, _, _, err := inspectBackground(test.payload); err == nil {
				t.Fatal("inspectBackground accepted forged or unsupported bytes")
			}
		})
	}
}

func TestInspectBackgroundEnforcesWebPDimensionLimit(t *testing.T) {
	accepted := testVP8XHeader(maxBackgroundDimension, maxBackgroundDimension)
	mime, extension, dimensions, err := inspectBackground(accepted)
	if err != nil {
		t.Fatal(err)
	}
	if mime != "image/webp" || extension != ".webp" || dimensions != image.Pt(maxBackgroundDimension, maxBackgroundDimension) {
		t.Fatalf("WebP inspection = mime %q, extension %q, dimensions %v", mime, extension, dimensions)
	}

	rejected := testVP8XHeader(maxBackgroundDimension+1, 1)
	if _, _, _, err := inspectBackground(rejected); err == nil || !strings.Contains(err.Error(), "dimensions") {
		t.Fatalf("oversized WebP dimension error = %v", err)
	}
}

func TestValidateThemeTokensRejectsCSSExpressionsAndUnsafeRanges(t *testing.T) {
	if err := validateThemeTokens(ThemeTokens{Canvas: `url("file:///secret")`}); err == nil || !strings.Contains(err.Error(), "safe literal color") {
		t.Fatalf("unsafe theme color error = %v", err)
	}
	if err := validateThemeTokens(ThemeTokens{BackgroundOpacity: 0.61}); err == nil || !strings.Contains(err.Error(), "background_opacity") {
		t.Fatalf("unsafe theme opacity error = %v", err)
	}
}

func TestActiveThemePreservesConfiguredZeroBackgroundOpacity(t *testing.T) {
	officialRoot := t.TempDir()
	manifest := testManifest("official.zero-opacity")
	manifest.Permissions = []Permission{PermissionUITheme, PermissionUIBackground}
	manifest.Theme = &ThemeSpec{Source: "dist/theme.json"}
	manifest.Contributes.Slots = []string{"app.background"}
	directory := writeRegistryTestPlugin(t, officialRoot, manifest)
	writeTestFile(t, filepath.Join(directory, manifest.Theme.Source), `{"default":{"background_opacity":0.22},"light":{},"dark":{}}`)
	writeRegistryTestLock(t, officialRoot, manifest.ID)
	registry, err := New(Options{OfficialDirectory: officialRoot, DataDirectory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.SetEnabled(manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	theme, err := registry.UpdateBackground(manifest.ID, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if theme.BackgroundOpacity == nil || *theme.BackgroundOpacity != 0 {
		t.Fatalf("configured opacity = %#v, want pointer to zero", theme.BackgroundOpacity)
	}
	payload, err := json.Marshal(theme)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(payload, []byte(`"background_opacity":0`)) {
		t.Fatalf("active theme JSON dropped zero opacity: %s", payload)
	}
}

func testVP8XHeader(width, height int) []byte {
	payload := make([]byte, 30)
	copy(payload[0:4], "RIFF")
	copy(payload[8:12], "WEBP")
	copy(payload[12:16], "VP8X")
	width--
	height--
	payload[24], payload[25], payload[26] = byte(width), byte(width>>8), byte(width>>16)
	payload[27], payload[28], payload[29] = byte(height), byte(height>>8), byte(height>>16)
	return payload
}

package ctf

import (
	"context"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

func TestArtifactPreviewRequiresCurrentJobMembership(t *testing.T) {
	core, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewService(core, ServiceOptions{Engine: &solvingEngine{}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = service.Close()
		_ = core.Close()
	})

	started, err := service.StartSampleChallenge(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(started.Artifacts) == 0 {
		t.Fatal("sample challenge did not admit its material artifact")
	}
	preview, err := service.GetArtifactPreview(
		context.Background(),
		started.Job.ID,
		started.Artifacts[0].ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Artifact.JobID != started.Job.ID || !preview.Previewable {
		t.Fatalf("unexpected admitted material preview: %#v", preview)
	}
	if _, err := service.GetArtifactPreview(context.Background(), started.Job.ID, "artifact_other_job"); err == nil {
		t.Fatal("artifact outside the current projection must be rejected")
	}
}

func TestBuildArtifactPreviewOnlyRendersBoundedUTF8Text(t *testing.T) {
	textArtifact := securityruntime.Artifact{
		ID:        "artifact_text",
		MediaType: "application/json; charset=utf-8",
	}
	text := strings.Repeat("界", maxArtifactPreviewBytes)
	preview := buildArtifactPreview(textArtifact, []byte(text))
	if !preview.Previewable || !preview.Truncated || preview.Content == "" {
		t.Fatalf("expected bounded text preview, got %#v", preview)
	}
	if len([]byte(preview.Content)) > maxArtifactPreviewBytes {
		t.Fatalf("preview exceeded byte limit: %d", len([]byte(preview.Content)))
	}

	binaryArtifact := securityruntime.Artifact{
		ID:        "artifact_binary",
		MediaType: "application/octet-stream",
	}
	binary := buildArtifactPreview(binaryArtifact, []byte{0x00, 0xff, 0x01})
	if binary.Previewable || binary.Content != "" || binary.Reason == "" {
		t.Fatalf("binary artifact must be metadata-only: %#v", binary)
	}

	invalidText := buildArtifactPreview(
		securityruntime.Artifact{ID: "artifact_invalid", MediaType: "text/plain"},
		[]byte{0xff},
	)
	if invalidText.Previewable || invalidText.Reason == "" {
		t.Fatalf("invalid UTF-8 must be metadata-only: %#v", invalidText)
	}
}

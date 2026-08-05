package evalbench

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCatalogMetadataDefaultsEveryTaskToUnknown(t *testing.T) {
	catalog := testCatalog(SplitDevelopment,
		testTask("task-b", SplitDevelopment, "web"),
		testTask("task-a", SplitDevelopment, "crypto"),
	)
	decisions := ClassifyCatalogWithoutReview(catalog)
	if len(decisions) != 2 ||
		decisions[0].TaskID != "task-a" ||
		decisions[1].TaskID != "task-b" {
		t.Fatalf("unexpected deterministic classification order: %#v", decisions)
	}
	for _, decision := range decisions {
		if decision.Classification != AdmissionUnknown || decision.StaticMaterial != nil {
			t.Fatalf("unreviewed task was not fail-closed: %#v", decision)
		}
	}
}

func TestAdmissionManifestRequiresExplicitBoundStaticReview(t *testing.T) {
	catalog := testCatalog(
		SplitDevelopment,
		testTask("static-one", SplitDevelopment, "crypto"),
	)
	prompt := "A plain text word puzzle. Return the uppercase spelling of milk."
	manifest := AdmissionManifest{
		SchemaVersion:       AdmissionSchemaVersion,
		SourceRevision:      NYUCTFBenchRevision,
		ReviewPolicyVersion: SafeStaticReviewPolicyVersion,
		Tasks: []Admission{{
			Split: SplitDevelopment, TaskID: "static-one",
			Classification: AdmissionSafeStatic,
			Reason:         "Human-reviewed synthetic text-only fixture with no executable material.",
			ReviewedBy:     "fixture-reviewer",
			ReviewedAt:     time.Date(2026, time.August, 1, 0, 0, 0, 0, time.UTC),
			StaticMaterial: &StaticMaterial{
				Prompt:               prompt,
				PromptSHA256:         digestText(prompt),
				ExpectedAnswerSHA256: ExpectedAnswerSHA256("MILK"),
			},
		}},
	}
	if err := ValidateAdmissionManifest(manifest, []Catalog{catalog}); err != nil {
		t.Fatal(err)
	}
	decision := DecideAdmission(manifest, catalog.Tasks[0])
	if decision.Classification != AdmissionSafeStatic ||
		decision.StaticMaterial == nil ||
		decision.StaticMaterial.Prompt != prompt {
		t.Fatalf("unexpected admission decision: %#v", decision)
	}

	manifest.Tasks[0].StaticMaterial.PromptSHA256 = strings.Repeat("0", 64)
	if err := ValidateAdmissionManifest(manifest, []Catalog{catalog}); err == nil ||
		!strings.Contains(err.Error(), "does not match") {
		t.Fatalf("expected prompt binding failure, got %v", err)
	}
}

func TestLoadAdmissionManifestRejectsExecutableSchemaExtension(t *testing.T) {
	catalog := testCatalog(
		SplitTest,
		testTask("blocked", SplitTest, "pwn"),
	)
	manifestPath := filepath.Join(t.TempDir(), "admission.json")
	raw := map[string]any{
		"schemaVersion":       AdmissionSchemaVersion,
		"sourceRevision":      NYUCTFBenchRevision,
		"reviewPolicyVersion": SafeStaticReviewPolicyVersion,
		"tasks": []map[string]any{{
			"split": "test", "taskId": "blocked",
			"classification": string(AdmissionBlockedExecution),
			"reason":         "Requires challenge execution.",
			"command":        "forbidden extension",
		}},
	}
	data, err := json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, manifestPath, data, 0o600)
	if _, err := LoadAdmissionManifest(manifestPath, []Catalog{catalog}); err == nil ||
		!strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("expected executable field rejection, got %v", err)
	}
}

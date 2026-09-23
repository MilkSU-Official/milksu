package vuln

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

func TestWriteLearningContextMirrorsSavedRecordsAndDropsSecrets(t *testing.T) {
	workspace := t.TempDir()
	secret := "sk-abcdefghijklmnopqrstuv"
	err := WriteLearningContext(workspace, "cve-2023-46604", []LearningRecord{
		{
			ID:        "learning-late",
			Kind:      "reflection",
			Concept:   "补丁版本",
			Content:   "用户确认公告已核对，密钥是 " + secret,
			CreatedAt: time.Date(2026, 9, 2, 0, 0, 0, 0, time.UTC),
		},
		{
			ID:        "learning-early",
			Kind:      "independent_step",
			Content:   "先核对受影响版本。",
			CreatedAt: time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(workspace, LearningContextFileName))
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if strings.Contains(text, secret) {
		t.Fatalf("learning context kept a secret: %s", text)
	}
	early := strings.Index(text, "先核对受影响版本")
	late := strings.Index(text, "公告已核对")
	if early < 0 || late < 0 || early > late {
		t.Fatalf("learning context order: %s", text)
	}
	if !strings.Contains(text, "CVE-2023-46604") || !strings.Contains(text, "[redacted]") {
		t.Fatalf("learning context: %s", text)
	}
	info, err := os.Stat(filepath.Join(workspace, LearningContextFileName))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %o", info.Mode().Perm())
	}

	if err := WriteLearningContext(workspace, "CVE-2023-46604", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(workspace, LearningContextFileName)); !os.IsNotExist(err) {
		t.Fatalf("empty learning context should remove the file: %v", err)
	}
}

func TestLearningByCVEReadsTheTrackingJobOnly(t *testing.T) {
	runtime, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = runtime.Close() })
	service, err := NewService(runtime)
	if err != nil {
		t.Fatal(err)
	}
	missing, err := service.LearningByCVE(context.Background(), "CVE-2023-46604")
	if err != nil {
		t.Fatal(err)
	}
	if missing != nil {
		t.Fatalf("missing tracking job returned %#v", missing)
	}
	projection, err := service.EnsureCVETrackingWorkspace(context.Background(), TrackingWorkspaceRequest{
		CVEID: "CVE-2023-46604",
		Title: "ActiveMQ",
	})
	if err != nil {
		t.Fatal(err)
	}
	projection, err = service.RecordLearning(context.Background(), projection.Job.ID, LearningRecordRequest{
		Kind:    "reflection",
		Content: "用户确认：只记录学习，不声明资产已验证。",
		Concept: "公告",
	})
	if err != nil {
		t.Fatal(err)
	}
	records, err := service.LearningByCVE(context.Background(), " cve-2023-46604 ")
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].Concept != "公告" {
		t.Fatalf("records = %#v", records)
	}
	if records, err = service.LearningByCVE(context.Background(), "not-a-cve"); err != nil || records != nil {
		t.Fatalf("invalid id records=%#v err=%v", records, err)
	}
}

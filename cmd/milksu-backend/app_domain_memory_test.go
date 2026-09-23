package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
	"github.com/MilkSU-Official/milksu/internal/vuln"
)

func TestDomainMemoryLandsInTheArtifactWorkspace(t *testing.T) {
	dataDirectory := filepath.Join(t.TempDir(), "appdata")
	t.Setenv(appdata.DirectoryOverrideEnv, dataDirectory)
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = runtime.Close() })
	vulnJobs, err := vuln.NewService(runtime)
	if err != nil {
		t.Fatal(err)
	}
	artifactDirectory := filepath.Join(t.TempDir(), "Documents", "MilkSU")
	app := &App{
		dataDirectory:     dataDirectory,
		artifactDirectory: artifactDirectory,
		conversations:     conversations,
		vulnJobs:          vulnJobs,
	}
	secret := "sk-abcdefghijklmnopqrstuv"
	projection, err := vulnJobs.EnsureCVETrackingWorkspace(context.Background(), vuln.TrackingWorkspaceRequest{
		CVEID: "CVE-2024-3400",
		Title: "PAN-OS",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.RecordVulnLearning(projection.Job.ID, vuln.LearningRecordRequest{
		Kind:    "reflection",
		Concept: "公告",
		Content: "用户确认公告已核对，密钥是 " + secret,
	}); err != nil {
		t.Fatal(err)
	}
	if found := findNamedFile(t, artifactDirectory, vuln.LearningContextFileName); found != "" {
		t.Fatalf("learning file was created before the workspace: %s", found)
	}

	if err := conversations.Save(conversation.StoredConversation{
		ID:    "cve-research-cve-2024-3400",
		Title: "PAN-OS",
		DomainTaskContext: map[string]any{
			"kind":  "cve",
			"cveId": "CVE-2024-3400",
		},
		Messages: []conversation.StoredMessage{},
	}); err != nil {
		t.Fatal(err)
	}
	workspace, err := app.resolveConversationWorkspace("cve-research-cve-2024-3400", "")
	if err != nil {
		t.Fatal(err)
	}
	learningPath := filepath.Join(workspace, vuln.LearningContextFileName)
	learning := readFileString(t, learningPath)
	if strings.Contains(learning, secret) || !strings.Contains(learning, "公告已核对") || !strings.Contains(learning, "[redacted]") {
		t.Fatalf("learning file: %s", learning)
	}

	if _, err := app.RecordVulnLearning(projection.Job.ID, vuln.LearningRecordRequest{
		Kind:    "variant",
		Concept: "补丁",
		Content: "用户确认补丁版本已记下。",
	}); err != nil {
		t.Fatal(err)
	}
	learning = readFileString(t, learningPath)
	if !strings.Contains(learning, "补丁版本已记下") {
		t.Fatalf("learning file was not refreshed: %s", learning)
	}

	emptyID := "cve-research-cve-2021-44228"
	if err := conversations.Save(conversation.StoredConversation{
		ID:    emptyID,
		Title: "Log4j",
		DomainTaskContext: map[string]any{
			"kind":  "cve",
			"cveId": "CVE-2021-44228",
		},
		Messages: []conversation.StoredMessage{},
	}); err != nil {
		t.Fatal(err)
	}
	emptyWorkspace, err := app.resolveConversationWorkspace(emptyID, "")
	if err != nil {
		t.Fatal(err)
	}
	stale := filepath.Join(emptyWorkspace, vuln.LearningContextFileName)
	if err := os.WriteFile(stale, []byte("旧记录"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := app.resolveConversationWorkspace(emptyID, emptyWorkspace); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("stale learning file remained: %v", err)
	}

	if err := conversations.Save(conversation.StoredConversation{
		ID:    "lab-job-job-one",
		Title: "本机练习机",
		DomainTaskContext: map[string]any{
			"kind":    "lab",
			"jobId":   "job-one",
			"title":   "本机练习机",
			"request": "只看本机进程",
		},
		Messages: []conversation.StoredMessage{},
	}); err != nil {
		t.Fatal(err)
	}
	labWorkspace, err := app.resolveConversationWorkspace("lab-job-job-one", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(labWorkspace, "report.md")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(labWorkspace, "TASK.md")); !os.IsNotExist(err) {
		t.Fatalf("lab job request was copied into a memory file: %v", err)
	}
}

func readFileString(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func findNamedFile(t *testing.T, root, name string) string {
	t.Helper()
	found := ""
	if _, err := os.Stat(root); os.IsNotExist(err) {
		return ""
	}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return walkErr
		}
		if entry.Name() == name {
			found = path
		}
		return nil
	})
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	return found
}

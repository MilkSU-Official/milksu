package lab

import (
	"path/filepath"
	"testing"
)

func TestStoreRoundTripsRenamesAndArchivesJobs(t *testing.T) {
	store, err := NewStoreAt(filepath.Join(t.TempDir(), "lab-jobs"))
	if err != nil {
		t.Fatalf("NewStoreAt: %v", err)
	}
	job := Job{
		ID:        "lab-job-one",
		Title:     "测试",
		Scope:     "local",
		Request:   "扫一下本机进程",
		CreatedAt: 42,
		UpdatedAt: 42,
	}
	if err := store.Save(job); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := store.Get(job.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Title != "测试" || got.Scope != "local" || got.Request != "扫一下本机进程" {
		t.Fatalf("unexpected job: %#v", got)
	}

	got.Title = "本地进程反病毒测试"
	got.UpdatedAt = 84
	if err := store.Save(got); err != nil {
		t.Fatalf("rename Save: %v", err)
	}
	renamed, err := store.Get(job.ID)
	if err != nil || renamed.Title != "本地进程反病毒测试" {
		t.Fatalf("renamed job: %#v, %v", renamed, err)
	}

	if err := store.Archive(job.ID); err != nil {
		t.Fatalf("Archive: %v", err)
	}
	active, err := store.List()
	if err != nil || len(active) != 0 {
		t.Fatalf("active after archive: %#v, %v", active, err)
	}
	archived, err := store.ListArchived()
	if err != nil || len(archived) != 1 || archived[0].Title != "本地进程反病毒测试" || archived[0].ArchivedAt == 0 {
		t.Fatalf("archived list: %#v, %v", archived, err)
	}
	if err := store.Restore(job.ID); err != nil {
		t.Fatalf("Restore: %v", err)
	}
	restored, err := store.List()
	if err != nil || len(restored) != 1 || restored[0].ArchivedAt != 0 {
		t.Fatalf("restored list: %#v, %v", restored, err)
	}
}

func TestStoreRejectsPathIDs(t *testing.T) {
	store, err := NewStoreAt(filepath.Join(t.TempDir(), "lab-jobs"))
	if err != nil {
		t.Fatalf("NewStoreAt: %v", err)
	}
	if err := store.Save(Job{ID: "../settings", Title: "nope"}); err == nil {
		t.Fatal("expected path id to be rejected")
	}
}

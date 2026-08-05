package evalbench

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestNYUCTFBenchSourceIsPinned(t *testing.T) {
	source := NYUCTFBenchSource()
	if source.Version != "v20250206" {
		t.Fatalf("unexpected source version %q", source.Version)
	}
	if source.Revision != "1dc13a0dc41a71504f727649679e2b5a6d0cb1b1" {
		t.Fatalf("unexpected source revision %q", source.Revision)
	}
	if source.License != "GPL-2.0-only" {
		t.Fatalf("unexpected source license %q", source.License)
	}
}

func TestImportNYUCTFBenchCatalogReadsOnlyIndexAndDirectoryShape(t *testing.T) {
	root := t.TempDir()
	first := createTaskDirectory(t, root, "development/2021/CSAW-Quals/web/alpha")
	second := createTaskDirectory(t, root, "development/2020/CSAW-Finals/rev/beta")

	// Deliberately invalid JSON proves the importer verifies challenge.json
	// exists without opening metadata that also contains flags upstream.
	writeTestFile(t, filepath.Join(first, "challenge.json"), []byte(`not json and never imported`), 0o600)
	writeTestFile(t, filepath.Join(second, "challenge.json"), []byte(`also not imported`), 0o600)
	writeCatalog(t, root, SplitDevelopment, map[string]catalogEntry{
		"z-task": {
			Year: "2021", Event: "CSAW-Quals", Category: "web",
			Challenge: "alpha", Path: "development/2021/CSAW-Quals/web/alpha",
		},
		"a-task": {
			Year: "2020", Event: "CSAW-Finals", Category: "rev",
			Challenge: "beta", Path: "development/2020/CSAW-Finals/rev/beta",
		},
	})

	catalog, err := ImportNYUCTFBenchCatalog(root, SplitDevelopment)
	if err != nil {
		t.Fatal(err)
	}
	if catalog.SchemaVersion != CatalogSchemaVersion || catalog.Source != NYUCTFBenchSource() {
		t.Fatalf("unexpected catalog identity: %#v", catalog)
	}
	gotIDs := []string{catalog.Tasks[0].ID, catalog.Tasks[1].ID}
	if !reflect.DeepEqual(gotIDs, []string{"a-task", "z-task"}) {
		t.Fatalf("tasks are not deterministically sorted: %v", gotIDs)
	}
	resolvedSecond, err := filepath.EvalSymlinks(second)
	if err != nil {
		t.Fatal(err)
	}
	resolvedFirst, err := filepath.EvalSymlinks(first)
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Tasks[0].Directory != resolvedSecond || catalog.Tasks[1].Directory != resolvedFirst {
		t.Fatalf("task directories were not resolved: %#v", catalog.Tasks)
	}

	exported, err := json.Marshal(catalog)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(exported), root) {
		t.Fatalf("catalog export leaked local root: %s", exported)
	}
}

func TestImportNYUCTFBenchCatalogRejectsTraversalAndUnknownSchema(t *testing.T) {
	t.Run("traversal", func(t *testing.T) {
		root := t.TempDir()
		writeCatalog(t, root, SplitTest, map[string]catalogEntry{
			"escape": {
				Year: "2021", Event: "CSAW-Quals", Category: "web",
				Challenge: "escape", Path: "test/../outside",
			},
		})
		if _, err := ImportNYUCTFBenchCatalog(root, SplitTest); err == nil ||
			!strings.Contains(err.Error(), "normalized relative slash path") {
			t.Fatalf("expected traversal rejection, got %v", err)
		}
	})

	t.Run("unknown index field", func(t *testing.T) {
		root := t.TempDir()
		writeTestFile(t, filepath.Join(root, "test_dataset.json"), []byte(`{
		  "task": {
		    "year": "2021",
		    "event": "CSAW-Quals",
		    "category": "web",
		    "challenge": "task",
		    "path": "test/2021/CSAW-Quals/web/task",
		    "command": "must not enter the metadata adapter"
		  }
		}`), 0o600)
		if _, err := ImportNYUCTFBenchCatalog(root, SplitTest); err == nil ||
			!strings.Contains(err.Error(), "unknown field") {
			t.Fatalf("expected strict schema rejection, got %v", err)
		}
	})
}

func TestImportNYUCTFBenchCatalogRejectsSymlinkedMetadataEscape(t *testing.T) {
	root := t.TempDir()
	taskDir := createTaskDirectory(t, root, "test/2021/CSAW-Quals/web/task")
	outside := filepath.Join(t.TempDir(), "challenge.json")
	writeTestFile(t, outside, []byte(`{}`), 0o600)
	if err := os.Symlink(outside, filepath.Join(taskDir, "challenge.json")); err != nil {
		t.Fatal(err)
	}
	writeCatalog(t, root, SplitTest, map[string]catalogEntry{
		"task": {
			Year: "2021", Event: "CSAW-Quals", Category: "web",
			Challenge: "task", Path: "test/2021/CSAW-Quals/web/task",
		},
	})

	if _, err := ImportNYUCTFBenchCatalog(root, SplitTest); err == nil ||
		!strings.Contains(err.Error(), "escapes benchmark root") {
		t.Fatalf("expected metadata symlink escape rejection, got %v", err)
	}
}

func createTaskDirectory(t *testing.T, root, relative string) string {
	t.Helper()
	directory := filepath.Join(root, filepath.FromSlash(relative))
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	return directory
}

func writeCatalog(t *testing.T, root string, split Split, entries map[string]catalogEntry) {
	t.Helper()
	data, err := json.Marshal(entries)
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(root, string(split)+"_dataset.json"), data, 0o600)
}

func writeTestFile(t *testing.T, path string, data []byte, mode os.FileMode) {
	t.Helper()
	if err := os.WriteFile(path, data, mode); err != nil {
		t.Fatal(err)
	}
}

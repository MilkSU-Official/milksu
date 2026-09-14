package codingenv

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Artifact discovery runs on every environment snapshot, and it is pointed at
// ignored directories that can hold a dependency tree. This measures the whole
// snapshot against the checkout it is running in, which is the largest tree
// available, so a regression that reintroduces a full walk is visible.
func TestInspectStaysFastOnARepositoryWithLargeIgnoredTrees(t *testing.T) {
	repository := repositoryRootForCostTest(t)
	started := time.Now()
	snapshot, err := Inspect(context.Background(), repository)
	elapsed := time.Since(started)
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.Git.IsRepository {
		t.Skip("this checkout is not a Git repository")
	}
	if elapsed > 3*time.Second {
		t.Fatalf("snapshot took %v, which a user waits through on every refresh", elapsed)
	}
	t.Logf("snapshot took %v and offered %d artifacts", elapsed, len(snapshot.Artifacts))
}

func repositoryRootForCostTest(t *testing.T) string {
	t.Helper()
	directory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, statErr := os.Stat(filepath.Join(directory, ".git")); statErr == nil {
			return directory
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			t.Skip("no repository checkout to measure against")
		}
		directory = parent
	}
}

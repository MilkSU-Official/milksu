package codingenv

import "testing"

func TestSuggestedArtifactPathsKeepsDeliverableGitChanges(t *testing.T) {
	paths := SuggestedArtifactPaths(Snapshot{
		Git: GitStatus{
			Changes: []GitChange{
				{Path: "README.md"},
				{Path: "src/app.ts"},
				{Path: "docs/preview.html"},
				{Path: "results.json"},
				{Path: "out.log"},
				{Path: "README.md"},
			},
		},
	})
	expected := []string{
		"README.md",
		"docs/preview.html",
		"results.json",
		"out.log",
	}
	if len(paths) != len(expected) {
		t.Fatalf("paths = %#v", paths)
	}
	for index, path := range expected {
		if paths[index] != path {
			t.Fatalf("paths = %#v", paths)
		}
	}
}

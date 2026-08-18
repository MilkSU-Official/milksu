package codingenv

import "testing"

func TestSuggestedArtifactPathsKeepsPreviewableGitChanges(t *testing.T) {
	paths := SuggestedArtifactPaths(Snapshot{
		Git: GitStatus{
			Changes: []GitChange{
				{Path: "README.md"},
				{Path: "src/app.ts"},
				{Path: "docs/preview.html"},
				{Path: "README.md"},
			},
		},
	})
	if len(paths) != 2 || paths[0] != "README.md" || paths[1] != "docs/preview.html" {
		t.Fatalf("paths = %#v", paths)
	}
}

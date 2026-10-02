package engine

import (
	"regexp"
	"testing"
)

func TestRuntimeVersionsReadsInstalledKernels(t *testing.T) {
	versions := RuntimeVersions()
	if len(versions) == 0 {
		t.Skip("no installed kernel packages reachable from this tree")
	}
	pattern := regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+`)
	for name, version := range versions {
		if name != "pi" && name != "dsh" {
			t.Fatalf("unexpected kernel id %q in %#v", name, versions)
		}
		if !pattern.MatchString(version) {
			t.Fatalf("kernel %q has a non-semver version %q", name, version)
		}
	}
	t.Logf("versions: %#v", versions)
}

func TestSidecarPackageRootsCoverOverrideAndDevelopment(t *testing.T) {
	t.Setenv("MILKSU_SIDECAR_DIR", t.TempDir())
	roots := sidecarPackageRoots()
	if len(roots) == 0 {
		t.Fatal("expected at least one candidate root")
	}
	// The override wins first; the development checkout (this repository)
	// remains a later candidate so a checkout without a packaged runtime
	// still reports versions.
	if roots[0] == "" {
		t.Fatalf("first root must be the override, got %#v", roots)
	}
	foundDevelopment := false
	for _, root := range roots {
		if root != "" && regexp.MustCompile(`node_modules$`).MatchString(root) {
			foundDevelopment = true
		}
	}
	if !foundDevelopment {
		t.Fatalf("expected a node_modules root candidate, got %#v", roots)
	}
}

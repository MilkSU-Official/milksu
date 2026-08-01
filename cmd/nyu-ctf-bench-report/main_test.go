package main

import (
	"bytes"
	"testing"
)

func TestReportCommandRequiresExplicitBenchmarkRoot(t *testing.T) {
	var output bytes.Buffer
	err := run([]string{"-split", "development"}, &output)
	if err == nil || err.Error() != "-root is required" {
		t.Fatalf("expected explicit root error, got %v", err)
	}
	if output.Len() != 0 {
		t.Fatalf("invalid command wrote output: %q", output.String())
	}
}

func TestRepeatedRunPathsRejectEmptyValues(t *testing.T) {
	var paths repeatedPaths
	if err := paths.Set(" "); err == nil {
		t.Fatal("expected an empty run path to be rejected")
	}
}

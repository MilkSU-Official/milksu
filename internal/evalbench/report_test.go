package evalbench

import (
	"bytes"
	"strings"
	"testing"
)

func TestAggregateProducesDeterministicReportedResults(t *testing.T) {
	catalog := testCatalog(SplitDevelopment,
		testTask("web-one", SplitDevelopment, "web"),
		testTask("rev-two", SplitDevelopment, "rev"),
		testTask("rev-three", SplitDevelopment, "rev"),
	)
	runs := []RunRecord{
		testRun("run-b", SplitDevelopment, "web-one", RunCompleted, OutcomeSolved),
		testRun("run-a", SplitDevelopment, "rev-two", RunCompleted, OutcomeUnsolved),
		testRun("run-c", SplitDevelopment, "rev-two", RunFailed, OutcomeUnknown),
	}

	report, err := Aggregate([]Catalog{catalog}, runs)
	if err != nil {
		t.Fatal(err)
	}
	if report.TaskCount != 3 || report.AttemptedTasks != 2 || report.SolvedTasks != 1 {
		t.Fatalf("unexpected task totals: %#v", report)
	}
	if report.Results.Runs != 3 || report.Results.Completed != 2 ||
		report.Results.Solved != 1 || report.Results.Unsolved != 1 ||
		report.Results.Failed != 1 || report.SolveRate != 0.5 {
		t.Fatalf("unexpected result totals: %#v", report.Results)
	}
	if len(report.Categories) != 2 ||
		report.Categories[0].Name != "rev" || report.Categories[1].Name != "web" {
		t.Fatalf("category summaries are not sorted: %#v", report.Categories)
	}
	if len(report.Configurations) != 1 ||
		report.Configurations[0].ResultAuthority != ReportedResultAuthority {
		t.Fatalf("unexpected configuration summaries: %#v", report.Configurations)
	}

	first, err := EncodeReport(report)
	if err != nil {
		t.Fatal(err)
	}
	secondReport, err := Aggregate([]Catalog{catalog}, runs)
	if err != nil {
		t.Fatal(err)
	}
	second, err := EncodeReport(secondReport)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first, second) {
		t.Fatalf("report encoding is not deterministic:\n%s\n---\n%s", first, second)
	}
	if bytes.Contains(first, []byte(catalog.Tasks[0].Directory)) {
		t.Fatalf("report leaked a local task directory: %s", first)
	}
}

func TestAggregateRejectsUnknownTaskAndDuplicateRun(t *testing.T) {
	catalog := testCatalog(SplitTest, testTask("web-one", SplitTest, "web"))
	unknown := testRun("unknown", SplitTest, "missing", RunCompleted, OutcomeUnsolved)
	if _, err := Aggregate([]Catalog{catalog}, []RunRecord{unknown}); err == nil ||
		!strings.Contains(err.Error(), "unknown benchmark task") {
		t.Fatalf("expected unknown task rejection, got %v", err)
	}

	duplicate := testRun("same", SplitTest, "web-one", RunCompleted, OutcomeUnsolved)
	if _, err := Aggregate([]Catalog{catalog}, []RunRecord{duplicate, duplicate}); err == nil ||
		!strings.Contains(err.Error(), "duplicate run id") {
		t.Fatalf("expected duplicate run rejection, got %v", err)
	}
}

func testCatalog(split Split, tasks ...Task) Catalog {
	return Catalog{
		SchemaVersion: CatalogSchemaVersion,
		Source:        NYUCTFBenchSource(),
		Split:         split,
		Tasks:         tasks,
	}
}

func testTask(id string, split Split, category string) Task {
	return Task{
		ID: id, Split: split, Year: "2021", Event: "CSAW-Quals",
		Category: category, Challenge: id,
		RelativePath: string(split) + "/2021/CSAW-Quals/" + category + "/" + id,
		Directory:    "/private/local/" + id,
	}
}

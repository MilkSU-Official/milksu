package evalbench

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
)

type ResultCounts struct {
	Runs      int `json:"runs"`
	Completed int `json:"completed"`
	Solved    int `json:"solved"`
	Unsolved  int `json:"unsolved"`
	Failed    int `json:"failed"`
	Cancelled int `json:"cancelled"`
}

type DimensionSummary struct {
	Name            string       `json:"name"`
	Tasks           int          `json:"tasks"`
	AttemptedTasks  int          `json:"attemptedTasks"`
	SolvedTasks     int          `json:"reportedSolvedTasks"`
	Results         ResultCounts `json:"results"`
	SolveRate       float64      `json:"reportedSolveRate"`
	ResultAuthority string       `json:"resultAuthority"`
}

type ConfigurationSummary struct {
	Model           ModelIdentity   `json:"model"`
	Harness         HarnessIdentity `json:"harness"`
	AttemptedTasks  int             `json:"attemptedTasks"`
	SolvedTasks     int             `json:"reportedSolvedTasks"`
	Results         ResultCounts    `json:"results"`
	SolveRate       float64         `json:"reportedSolveRate"`
	ResultAuthority string          `json:"resultAuthority"`
}

type Report struct {
	SchemaVersion   string                 `json:"schemaVersion"`
	Source          Source                 `json:"source"`
	TaskCount       int                    `json:"taskCount"`
	AttemptedTasks  int                    `json:"attemptedTasks"`
	SolvedTasks     int                    `json:"reportedSolvedTasks"`
	Results         ResultCounts           `json:"results"`
	SolveRate       float64                `json:"reportedSolveRate"`
	ResultAuthority string                 `json:"resultAuthority"`
	Splits          []DimensionSummary     `json:"splits"`
	Categories      []DimensionSummary     `json:"categories"`
	Configurations  []ConfigurationSummary `json:"configurations"`
}

type summaryAccumulator struct {
	taskIDs  map[string]struct{}
	attempts map[string]struct{}
	solved   map[string]struct{}
	results  ResultCounts
}

type configurationAccumulator struct {
	model    ModelIdentity
	harness  HarnessIdentity
	attempts map[string]struct{}
	solved   map[string]struct{}
	results  ResultCounts
}

// Aggregate builds a deterministic static report. Runs are treated only as
// reported outcomes; this package does not execute or verify a challenge.
func Aggregate(catalogs []Catalog, runs []RunRecord) (Report, error) {
	if len(catalogs) == 0 {
		return Report{}, errors.New("at least one catalog is required")
	}
	source := NYUCTFBenchSource()
	taskIndex := map[string]Task{}
	splitSummaries := map[string]*summaryAccumulator{}
	categorySummaries := map[string]*summaryAccumulator{}

	for _, catalog := range catalogs {
		if err := validateCatalog(catalog, source); err != nil {
			return Report{}, err
		}
		for _, task := range catalog.Tasks {
			key := taskKey(task.Split, task.ID)
			if _, exists := taskIndex[key]; exists {
				return Report{}, fmt.Errorf("duplicate benchmark task %s", key)
			}
			taskIndex[key] = task
			addTask(splitSummaries, string(task.Split), key)
			addTask(categorySummaries, task.Category, key)
		}
	}

	configurations := map[string]*configurationAccumulator{}
	all := newSummaryAccumulator()
	for _, key := range sortedTaskKeys(taskIndex) {
		all.taskIDs[key] = struct{}{}
	}
	seenRuns := map[string]struct{}{}
	for _, run := range runs {
		if err := ValidateRunRecord(run); err != nil {
			return Report{}, fmt.Errorf("run %q: %w", run.RunID, err)
		}
		if _, exists := seenRuns[run.RunID]; exists {
			return Report{}, fmt.Errorf("duplicate run id %q", run.RunID)
		}
		seenRuns[run.RunID] = struct{}{}

		key := taskKey(run.Split, run.TaskID)
		task, ok := taskIndex[key]
		if !ok {
			return Report{}, fmt.Errorf("run %q references unknown benchmark task %s", run.RunID, key)
		}
		accumulateResult(all, key, run)
		accumulateResult(splitSummaries[string(run.Split)], key, run)
		accumulateResult(categorySummaries[task.Category], key, run)

		configKey := modelKey(run.Model) + "\x00" + harnessKey(run.Harness)
		configuration := configurations[configKey]
		if configuration == nil {
			configuration = &configurationAccumulator{
				model:    run.Model,
				harness:  run.Harness,
				attempts: map[string]struct{}{},
				solved:   map[string]struct{}{},
			}
			configurations[configKey] = configuration
		}
		accumulateConfiguration(configuration, key, run)
	}

	return Report{
		SchemaVersion:   ReportSchemaVersion,
		Source:          source,
		TaskCount:       len(taskIndex),
		AttemptedTasks:  len(all.attempts),
		SolvedTasks:     len(all.solved),
		Results:         all.results,
		SolveRate:       reportedSolveRate(all.results),
		ResultAuthority: ReportedResultAuthority,
		Splits:          dimensionReports(splitSummaries),
		Categories:      dimensionReports(categorySummaries),
		Configurations:  configurationReports(configurations),
	}, nil
}

func EncodeReport(report Report) ([]byte, error) {
	if report.SchemaVersion != ReportSchemaVersion ||
		report.Source != NYUCTFBenchSource() ||
		report.ResultAuthority != ReportedResultAuthority {
		return nil, errors.New("invalid eval report")
	}
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

func validateCatalog(catalog Catalog, expected Source) error {
	if catalog.SchemaVersion != CatalogSchemaVersion {
		return fmt.Errorf("unsupported catalog schema %q", catalog.SchemaVersion)
	}
	if catalog.Source != expected {
		return errors.New("catalog source does not match the pinned NYU CTF Bench source")
	}
	if err := validateSplit(catalog.Split); err != nil {
		return err
	}
	for _, task := range catalog.Tasks {
		if task.Split != catalog.Split {
			return fmt.Errorf("catalog task %q split does not match catalog", task.ID)
		}
		if !taskIDPattern.MatchString(task.ID) || task.Year == "" || task.Event == "" ||
			task.Category == "" || task.Challenge == "" || task.RelativePath == "" {
			return fmt.Errorf("catalog task %q is incomplete", task.ID)
		}
	}
	return nil
}

func newSummaryAccumulator() *summaryAccumulator {
	return &summaryAccumulator{
		taskIDs:  map[string]struct{}{},
		attempts: map[string]struct{}{},
		solved:   map[string]struct{}{},
	}
}

func addTask(target map[string]*summaryAccumulator, name, taskID string) {
	summary := target[name]
	if summary == nil {
		summary = newSummaryAccumulator()
		target[name] = summary
	}
	summary.taskIDs[taskID] = struct{}{}
}

func accumulateResult(summary *summaryAccumulator, taskID string, run RunRecord) {
	summary.attempts[taskID] = struct{}{}
	accumulateCounts(&summary.results, run)
	if run.Status == RunCompleted && run.ReportedOutcome == OutcomeSolved {
		summary.solved[taskID] = struct{}{}
	}
}

func accumulateConfiguration(summary *configurationAccumulator, taskID string, run RunRecord) {
	summary.attempts[taskID] = struct{}{}
	accumulateCounts(&summary.results, run)
	if run.Status == RunCompleted && run.ReportedOutcome == OutcomeSolved {
		summary.solved[taskID] = struct{}{}
	}
}

func accumulateCounts(counts *ResultCounts, run RunRecord) {
	counts.Runs++
	switch run.Status {
	case RunCompleted:
		counts.Completed++
		if run.ReportedOutcome == OutcomeSolved {
			counts.Solved++
		} else {
			counts.Unsolved++
		}
	case RunFailed:
		counts.Failed++
	case RunCancelled:
		counts.Cancelled++
	}
}

func reportedSolveRate(counts ResultCounts) float64 {
	if counts.Completed == 0 {
		return 0
	}
	return float64(counts.Solved) / float64(counts.Completed)
}

func dimensionReports(input map[string]*summaryAccumulator) []DimensionSummary {
	names := make([]string, 0, len(input))
	for name := range input {
		names = append(names, name)
	}
	sort.Strings(names)
	result := make([]DimensionSummary, 0, len(names))
	for _, name := range names {
		summary := input[name]
		result = append(result, DimensionSummary{
			Name:            name,
			Tasks:           len(summary.taskIDs),
			AttemptedTasks:  len(summary.attempts),
			SolvedTasks:     len(summary.solved),
			Results:         summary.results,
			SolveRate:       reportedSolveRate(summary.results),
			ResultAuthority: ReportedResultAuthority,
		})
	}
	return result
}

func configurationReports(input map[string]*configurationAccumulator) []ConfigurationSummary {
	keys := make([]string, 0, len(input))
	for key := range input {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]ConfigurationSummary, 0, len(keys))
	for _, key := range keys {
		summary := input[key]
		result = append(result, ConfigurationSummary{
			Model:           summary.model,
			Harness:         summary.harness,
			AttemptedTasks:  len(summary.attempts),
			SolvedTasks:     len(summary.solved),
			Results:         summary.results,
			SolveRate:       reportedSolveRate(summary.results),
			ResultAuthority: ReportedResultAuthority,
		})
	}
	return result
}

func taskKey(split Split, id string) string {
	return string(split) + "/" + id
}

func sortedTaskKeys(input map[string]Task) []string {
	keys := make([]string, 0, len(input))
	for key := range input {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func modelKey(model ModelIdentity) string {
	return model.Provider + "\x00" + model.Name + "\x00" + model.Revision
}

func harnessKey(harness HarnessIdentity) string {
	return harness.Name + "\x00" + harness.Version + "\x00" + harness.ConfigSHA256
}

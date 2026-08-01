package evalbench

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

type ResultCounts struct {
	Runs      int `json:"runs"`
	Completed int `json:"completed"`
	Solved    int `json:"solved"`
	Unsolved  int `json:"unsolved"`
	Failed    int `json:"failed"`
	Cancelled int `json:"cancelled"`
}

type ExitReasonCount struct {
	Reason string `json:"reason"`
	Count  int    `json:"count"`
}

type ExecutionAggregate struct {
	ProviderCalls       int               `json:"providerCalls"`
	InputTokens         int64             `json:"inputTokens"`
	OutputTokens        int64             `json:"outputTokens"`
	ActualCostMicroUSD  int64             `json:"actualCostMicroUsd"`
	UsageUnmeasuredRuns int               `json:"usageUnmeasuredRuns,omitempty"`
	UsageMeasurements   []string          `json:"usageMeasurements,omitempty"`
	ExitReasons         []ExitReasonCount `json:"exitReasons"`
}

type DimensionSummary struct {
	Name            string             `json:"name"`
	Tasks           int                `json:"tasks"`
	AttemptedTasks  int                `json:"attemptedTasks"`
	SolvedTasks     int                `json:"reportedSolvedTasks"`
	Results         ResultCounts       `json:"results"`
	SolveRate       float64            `json:"reportedSolveRate"`
	ResultAuthority string             `json:"resultAuthority"`
	Execution       ExecutionAggregate `json:"execution"`
}

type ConfigurationSummary struct {
	Model           ModelIdentity      `json:"model"`
	Harness         HarnessIdentity    `json:"harness"`
	AttemptedTasks  int                `json:"attemptedTasks"`
	SolvedTasks     int                `json:"reportedSolvedTasks"`
	Results         ResultCounts       `json:"results"`
	SolveRate       float64            `json:"reportedSolveRate"`
	ResultAuthority string             `json:"resultAuthority"`
	Execution       ExecutionAggregate `json:"execution"`
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
	Execution       ExecutionAggregate     `json:"execution"`
	Splits          []DimensionSummary     `json:"splits"`
	Categories      []DimensionSummary     `json:"categories"`
	Configurations  []ConfigurationSummary `json:"configurations"`
}

type summaryAccumulator struct {
	taskIDs     map[string]struct{}
	attempts    map[string]struct{}
	solved      map[string]struct{}
	results     ResultCounts
	authorities map[string]struct{}
	execution   executionAccumulator
}

type configurationAccumulator struct {
	model       ModelIdentity
	harness     HarnessIdentity
	attempts    map[string]struct{}
	solved      map[string]struct{}
	results     ResultCounts
	authorities map[string]struct{}
	execution   executionAccumulator
}

type executionAccumulator struct {
	providerCalls       int
	inputTokens         int64
	outputTokens        int64
	actualCostMicroUSD  int64
	usageUnmeasuredRuns int
	usageMeasurements   map[string]struct{}
	exitReasons         map[string]int
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
				model:       run.Model,
				harness:     run.Harness,
				attempts:    map[string]struct{}{},
				solved:      map[string]struct{}{},
				authorities: map[string]struct{}{},
				execution: executionAccumulator{
					usageMeasurements: map[string]struct{}{},
					exitReasons:       map[string]int{},
				},
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
		ResultAuthority: summarizedAuthority(all.authorities),
		Execution:       executionReport(all.execution),
		Splits:          dimensionReports(splitSummaries),
		Categories:      dimensionReports(categorySummaries),
		Configurations:  configurationReports(configurations),
	}, nil
}

func EncodeReport(report Report) ([]byte, error) {
	if report.SchemaVersion != ReportSchemaVersion ||
		report.Source != NYUCTFBenchSource() ||
		!validReportAuthority(report.ResultAuthority) {
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
		taskIDs:     map[string]struct{}{},
		attempts:    map[string]struct{}{},
		solved:      map[string]struct{}{},
		authorities: map[string]struct{}{},
		execution: executionAccumulator{
			usageMeasurements: map[string]struct{}{},
			exitReasons:       map[string]int{},
		},
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
	summary.authorities[run.ResultAuthority] = struct{}{}
	accumulateExecution(&summary.execution, run)
	accumulateCounts(&summary.results, run)
	if run.Status == RunCompleted && run.ReportedOutcome == OutcomeSolved {
		summary.solved[taskID] = struct{}{}
	}
}

func accumulateConfiguration(summary *configurationAccumulator, taskID string, run RunRecord) {
	summary.attempts[taskID] = struct{}{}
	summary.authorities[run.ResultAuthority] = struct{}{}
	accumulateExecution(&summary.execution, run)
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
			ResultAuthority: summarizedAuthority(summary.authorities),
			Execution:       executionReport(summary.execution),
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
			ResultAuthority: summarizedAuthority(summary.authorities),
			Execution:       executionReport(summary.execution),
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

func accumulateExecution(summary *executionAccumulator, run RunRecord) {
	summary.inputTokens += run.Metrics.InputTokens
	summary.outputTokens += run.Metrics.OutputTokens
	if measurement := strings.TrimSpace(run.Metrics.UsageMeasurement); measurement != "" {
		summary.usageUnmeasuredRuns++
		summary.usageMeasurements[measurement] = struct{}{}
	}
	if run.Execution == nil {
		return
	}
	summary.providerCalls += run.Execution.ProviderCalls
	summary.actualCostMicroUSD += run.Execution.ActualCostMicroUSD
	summary.exitReasons[run.Execution.ExitReason]++
}

func executionReport(summary executionAccumulator) ExecutionAggregate {
	reasons := make([]string, 0, len(summary.exitReasons))
	for reason := range summary.exitReasons {
		reasons = append(reasons, reason)
	}
	sort.Strings(reasons)
	counts := make([]ExitReasonCount, 0, len(reasons))
	for _, reason := range reasons {
		counts = append(counts, ExitReasonCount{
			Reason: reason,
			Count:  summary.exitReasons[reason],
		})
	}
	measurements := make([]string, 0, len(summary.usageMeasurements))
	for measurement := range summary.usageMeasurements {
		measurements = append(measurements, measurement)
	}
	sort.Strings(measurements)
	return ExecutionAggregate{
		ProviderCalls:       summary.providerCalls,
		InputTokens:         summary.inputTokens,
		OutputTokens:        summary.outputTokens,
		ActualCostMicroUSD:  summary.actualCostMicroUSD,
		UsageUnmeasuredRuns: summary.usageUnmeasuredRuns,
		UsageMeasurements:   measurements,
		ExitReasons:         counts,
	}
}

func summarizedAuthority(authorities map[string]struct{}) string {
	if len(authorities) == 1 {
		for authority := range authorities {
			return authority
		}
	}
	if len(authorities) > 1 {
		return MixedResultAuthority
	}
	return ReportedResultAuthority
}

func validReportAuthority(authority string) bool {
	return authority == ReportedResultAuthority ||
		authority == DeterministicStaticAnswerAuthority ||
		authority == MixedResultAuthority
}

package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/evalbench"
	"github.com/google/uuid"
)

type dependencies struct {
	loadProvider func() (evalbench.OnceProvider, error)
	now          func() time.Time
	newRunID     func() string
}

func main() {
	deps := dependencies{
		loadProvider: loadConfiguredDeepSeek,
		now:          time.Now,
		newRunID:     uuid.NewString,
	}
	if err := run(os.Args[1:], os.Stdout, deps); err != nil {
		fmt.Fprintln(os.Stderr, "nyu-ctf-bench-run:", err)
		os.Exit(1)
	}
}

func run(arguments []string, stdout io.Writer, deps dependencies) error {
	flags := flag.NewFlagSet("nyu-ctf-bench-run", flag.ContinueOnError)
	flags.SetOutput(io.Discard)

	root := flags.String("root", "", "path to the pinned NYU CTF Bench checkout")
	splitName := flags.String("split", string(evalbench.SplitDevelopment), "development or test")
	taskID := flags.String("task", "", "canonical task id from the pinned catalog")
	admissionPath := flags.String("admission", "", "optional human-reviewed admission manifest")
	execute := flags.Bool("execute", false, "perform one bounded DeepSeek inference; otherwise dry-run")
	output := flags.String("out", "", "optional JSON output path; defaults to stdout")
	model := flags.String("model", "deepseek-v4-flash", "configured DeepSeek model")
	timeoutMillis := flags.Int64("timeout-ms", 30_000, "hard inference timeout in milliseconds")
	maxInputBytes := flags.Int("max-input-bytes", 8<<10, "maximum system plus static prompt bytes")
	maxOutputTokens := flags.Int("max-output-tokens", 128, "maximum completion tokens")
	maxCostMicroUSD := flags.Int64("max-cost-microusd", 5_000, "maximum estimated and actual cost")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments: %s", strings.Join(flags.Args(), " "))
	}
	if strings.TrimSpace(*root) == "" {
		return errors.New("-root is required")
	}
	if strings.TrimSpace(*taskID) == "" {
		return errors.New("-task is required")
	}
	if deps.newRunID == nil {
		return errors.New("run id source is unavailable")
	}

	split := evalbench.Split(*splitName)
	catalog, err := evalbench.ImportNYUCTFBenchCatalog(*root, split)
	if err != nil {
		return err
	}
	task, err := evalbench.FindTask(catalog, strings.TrimSpace(*taskID))
	if err != nil {
		return err
	}
	decision := evalbench.AdmissionDecision{
		SourceRevision: evalbench.NYUCTFBenchRevision,
		Split:          task.Split, TaskID: task.ID,
		Classification: evalbench.AdmissionUnknown,
		Reason:         "No human-reviewed admission manifest was supplied.",
	}
	if strings.TrimSpace(*admissionPath) != "" {
		manifest, err := evalbench.LoadAdmissionManifest(
			strings.TrimSpace(*admissionPath),
			[]evalbench.Catalog{catalog},
		)
		if err != nil {
			return err
		}
		decision = evalbench.DecideAdmission(manifest, task)
	}
	plan := evalbench.RunPlan{
		RunID:     deps.newRunID(),
		Task:      task,
		Admission: decision,
		Model: evalbench.ModelIdentity{
			Provider: "deepseek",
			Name:     strings.TrimSpace(*model),
			Revision: "api",
		},
		Harness: evalbench.HarnessIdentity{
			Name:         "milksu-safe-static",
			Version:      "v1alpha1",
			ConfigSHA256: evalbench.SafeStaticHarnessConfigSHA256(),
		},
		Budget: evalbench.RunBudget{
			TimeoutMillis:   *timeoutMillis,
			MaxInputBytes:   *maxInputBytes,
			MaxOutputTokens: *maxOutputTokens,
			MaxCostMicroUSD: *maxCostMicroUSD,
		},
		Pricing: evalbench.DeepSeekV4FlashPricing20260801(),
	}

	preflight, err := evalbench.BuildDryRun(plan)
	if err != nil {
		return err
	}
	if !*execute {
		return writeJSON(*output, stdout, preflight)
	}
	if !preflight.Runnable {
		record, err := (evalbench.Runner{
			Provider: blockedProvider{},
			Now:      deps.now,
		}).Run(context.Background(), plan)
		if err != nil {
			return err
		}
		return writeBaselineRecord(*output, stdout, record)
	}
	if deps.loadProvider == nil {
		return errors.New("DeepSeek provider loader is unavailable")
	}
	provider, err := deps.loadProvider()
	if err != nil {
		return err
	}
	record, err := (evalbench.Runner{Provider: provider, Now: deps.now}).Run(
		context.Background(),
		plan,
	)
	if err != nil {
		return err
	}
	return writeBaselineRecord(*output, stdout, record)
}

type blockedProvider struct{}

func (blockedProvider) ID() string {
	return "deepseek"
}

func (blockedProvider) CompleteOnce(
	context.Context,
	evalbench.InferenceRequest,
) (evalbench.Completion, error) {
	return evalbench.Completion{}, errors.New("blocked provider must never be called")
}

func loadConfiguredDeepSeek() (evalbench.OnceProvider, error) {
	store, err := config.NewStore()
	if err != nil {
		return nil, fmt.Errorf("load MilkSU settings: %w", err)
	}
	settings := store.GetResolved()
	provider, ok := settings.Providers["deepseek"]
	if !ok || !provider.Enabled || strings.TrimSpace(provider.APIKey) == "" {
		return nil, errors.New("DeepSeek is not enabled with a local MilkSU credential")
	}
	baseURL := evalbench.DefaultDeepSeekBaseURL
	if provider.BaseURL != nil && strings.TrimSpace(*provider.BaseURL) != "" {
		baseURL = strings.TrimSpace(*provider.BaseURL)
	}
	return evalbench.NewDeepSeekProvider(provider.APIKey, baseURL, &http.Client{})
}

func writeBaselineRecord(path string, stdout io.Writer, record evalbench.BaselineRunRecord) error {
	data, err := evalbench.EncodeBaselineRunRecord(record)
	if err != nil {
		return err
	}
	return writeBytes(path, stdout, data)
}

func writeJSON(path string, stdout io.Writer, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return writeBytes(path, stdout, append(data, '\n'))
}

func writeBytes(path string, stdout io.Writer, data []byte) error {
	if strings.TrimSpace(path) == "" {
		_, err := stdout.Write(data)
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

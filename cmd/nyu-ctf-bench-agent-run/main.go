package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/evalbench"
	"github.com/MilkSU-Official/milksu/internal/evalbenchruntime"
	"github.com/google/uuid"
)

type dependencies struct {
	loadRuntime func(string, string, string) (evalbench.AgentRuntime, error)
	now         func() time.Time
	newRunID    func() string
}

func main() {
	deps := dependencies{
		loadRuntime: loadConfiguredRuntime,
		now:         time.Now,
		newRunID:    uuid.NewString,
	}
	if err := run(os.Args[1:], os.Stdout, deps); err != nil {
		fmt.Fprintln(os.Stderr, "nyu-ctf-bench-agent-run:", err)
		os.Exit(1)
	}
}

func run(arguments []string, stdout io.Writer, deps dependencies) error {
	flags := flag.NewFlagSet("nyu-ctf-bench-agent-run", flag.ContinueOnError)
	flags.SetOutput(io.Discard)

	root := flags.String("root", "", "path to the pinned NYU CTF Bench checkout")
	splitName := flags.String("split", string(evalbench.SplitDevelopment), "development or test")
	taskID := flags.String("task", "", "canonical task id from the pinned catalog")
	admissionPath := flags.String("admission", "", "human-reviewed admission manifest")
	execute := flags.Bool("execute", false, "run the two-turn read-only MilkSU Agent harness")
	output := flags.String("out", "", "optional JSON output path; defaults to stdout")
	provider := flags.String("provider", "deepseek", "configured MilkSU provider")
	model := flags.String("model", "deepseek-v4-flash", "configured MilkSU model")
	sidecarDirectory := flags.String(
		"sidecar-dir",
		defaultSidecarDirectory(),
		"complete packaged MilkSU Sidecar directory",
	)
	timeoutMillis := flags.Int64("turn-timeout-ms", 60_000, "hard timeout for each Agent turn")
	maxToolCalls := flags.Int("max-tool-calls", 12, "maximum read-only tool calls")
	maxAssistantBytes := flags.Int("max-assistant-bytes", 32<<10, "maximum assistant output bytes")
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
		Split:          task.Split,
		TaskID:         task.ID,
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
	plan := evalbench.AgentRuntimePlan{
		RunID:     deps.newRunID(),
		Task:      task,
		Admission: decision,
		Model: evalbench.ModelIdentity{
			Provider: strings.TrimSpace(*provider),
			Name:     strings.TrimSpace(*model),
			Revision: "api",
		},
		Harness: evalbench.HarnessIdentity{
			Name:         "milksu-agent-runtime-safe-static",
			Version:      "v1alpha1",
			ConfigSHA256: evalbench.SafeAgentRuntimeHarnessConfigSHA256(),
		},
		Budget: evalbench.AgentRuntimeBudget{
			TurnTimeoutMillis: *timeoutMillis,
			MaxTurns:          2,
			MaxToolCalls:      *maxToolCalls,
			MaxAssistantBytes: *maxAssistantBytes,
		},
	}
	preflight, err := evalbench.BuildAgentRuntimeDryRun(plan)
	if err != nil {
		return err
	}
	if !*execute {
		return writeJSON(*output, stdout, preflight)
	}

	var runtime evalbench.AgentRuntime
	if preflight.Runnable {
		if deps.loadRuntime == nil {
			return errors.New("MilkSU Agent runtime loader is unavailable")
		}
		runtime, err = deps.loadRuntime(
			plan.Model.Provider,
			plan.Model.Name,
			strings.TrimSpace(*sidecarDirectory),
		)
		if err != nil {
			return err
		}
	}
	record, err := (evalbench.AgentRuntimeRunner{
		Runtime: runtime,
		Now:     deps.now,
	}).Run(context.Background(), plan)
	if err != nil {
		return err
	}
	data, err := evalbench.EncodeAgentRuntimeRunRecord(record)
	if err != nil {
		return err
	}
	return writeBytes(*output, stdout, data)
}

func loadConfiguredRuntime(
	providerName,
	modelName,
	sidecarDirectory string,
) (evalbench.AgentRuntime, error) {
	store, err := config.NewStore()
	if err != nil {
		return nil, fmt.Errorf("load MilkSU settings: %w", err)
	}
	settings := store.GetResolved()
	provider, ok := settings.Providers[providerName]
	if !ok || !provider.Enabled || strings.TrimSpace(provider.APIKey) == "" {
		return nil, fmt.Errorf(
			"%s is not enabled with a local MilkSU credential",
			providerName,
		)
	}
	settings.ActiveProvider = providerName
	settings.ActiveModel = modelName
	return evalbenchruntime.NewEngineRuntimeAt(settings, sidecarDirectory), nil
}

func defaultSidecarDirectory() string {
	workingDirectory, err := os.Getwd()
	if err != nil {
		return ""
	}
	directory := filepath.Join(
		workingDirectory,
		"build",
		"sidecar",
		goruntime.GOOS+"-"+goruntime.GOARCH,
	)
	for _, name := range []string{"node", "chat-bridge.cjs"} {
		info, err := os.Stat(filepath.Join(directory, name))
		if err != nil || info.IsDir() {
			return ""
		}
	}
	return directory
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

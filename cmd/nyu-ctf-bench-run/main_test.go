package main

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/evalbench"
)

type fakeCLIProvider struct {
	calls int
}

func (*fakeCLIProvider) ID() string { return "deepseek" }

func (provider *fakeCLIProvider) CompleteOnce(
	_ context.Context,
	_ evalbench.InferenceRequest,
) (evalbench.Completion, error) {
	provider.calls++
	return evalbench.Completion{
		Answer: "MILK", FinishReason: "stop", Model: "deepseek-v4-flash",
		Usage: evalbench.TokenUsage{
			InputTokens: 20, InputCacheMissTokens: 20, OutputTokens: 4,
		},
	}, nil
}

func TestCLIDryRunDoesNotLoadProvider(t *testing.T) {
	root, admission, prompt := writeSyntheticFixture(t)
	loadCalls := 0
	var stdout bytes.Buffer
	err := run([]string{
		"-root", root,
		"-split", "development",
		"-task", "synthetic-static",
		"-admission", admission,
	}, &stdout, dependencies{
		loadProvider: func() (evalbench.OnceProvider, error) {
			loadCalls++
			return &fakeCLIProvider{}, nil
		},
		now:      time.Now,
		newRunID: func() string { return "dry-run" },
	})
	if err != nil {
		t.Fatal(err)
	}
	if loadCalls != 0 {
		t.Fatalf("dry-run loaded credentials/provider %d times", loadCalls)
	}
	if strings.Contains(stdout.String(), prompt) {
		t.Fatalf("dry-run leaked static prompt: %s", stdout.String())
	}
	var report evalbench.DryRunReport
	if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	if !report.Runnable || report.ProviderCalls != 0 ||
		report.Admission != evalbench.AdmissionSafeStatic {
		t.Fatalf("unexpected dry-run report: %#v", report)
	}
}

func TestCLIFakeProviderSyntheticFixtureE2E(t *testing.T) {
	root, admission, prompt := writeSyntheticFixture(t)
	provider := &fakeCLIProvider{}
	current := time.Date(2026, time.August, 1, 0, 0, 0, 0, time.UTC)
	var stdout bytes.Buffer
	err := run([]string{
		"-root", root,
		"-split", "development",
		"-task", "synthetic-static",
		"-admission", admission,
		"-execute",
	}, &stdout, dependencies{
		loadProvider: func() (evalbench.OnceProvider, error) {
			return provider, nil
		},
		now: func() time.Time {
			value := current
			current = current.Add(time.Second)
			return value
		},
		newRunID: func() string { return "synthetic-e2e" },
	})
	if err != nil {
		t.Fatal(err)
	}
	if provider.calls != 1 {
		t.Fatalf("expected exactly one fake provider call, got %d", provider.calls)
	}
	for _, forbidden := range []string{"MILK", prompt, "api_key", "credential"} {
		if strings.Contains(stdout.String(), forbidden) {
			t.Fatalf("CLI persisted forbidden plaintext %q: %s", forbidden, stdout.String())
		}
	}
	record, err := evalbench.DecodeBaselineRunRecord(stdout.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if record.ExitReason != evalbench.ExitCompletedSolved ||
		record.ProviderCalls != 1 ||
		record.Judge == nil ||
		!record.Judge.Matched {
		t.Fatalf("unexpected synthetic result: %#v", record)
	}
}

func TestCLIWithoutAdmissionFailsClosedWithoutProvider(t *testing.T) {
	root, _, _ := writeSyntheticFixture(t)
	loadCalls := 0
	var stdout bytes.Buffer
	err := run([]string{
		"-root", root,
		"-split", "development",
		"-task", "synthetic-static",
		"-execute",
	}, &stdout, dependencies{
		loadProvider: func() (evalbench.OnceProvider, error) {
			loadCalls++
			return &fakeCLIProvider{}, nil
		},
		now:      time.Now,
		newRunID: func() string { return "blocked" },
	})
	if err != nil {
		t.Fatal(err)
	}
	if loadCalls != 0 {
		t.Fatalf("unknown task loaded provider %d times", loadCalls)
	}
	record, err := evalbench.DecodeBaselineRunRecord(stdout.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if record.ExitReason != evalbench.ExitAdmissionBlocked ||
		record.ProviderCalls != 0 {
		t.Fatalf("unknown task was not blocked: %#v", record)
	}
}

func TestCLIBudgetRejectionDoesNotLoadProvider(t *testing.T) {
	root, admission, _ := writeSyntheticFixture(t)
	loadCalls := 0
	var stdout bytes.Buffer
	err := run([]string{
		"-root", root,
		"-split", "development",
		"-task", "synthetic-static",
		"-admission", admission,
		"-max-cost-microusd", "1",
		"-execute",
	}, &stdout, dependencies{
		loadProvider: func() (evalbench.OnceProvider, error) {
			loadCalls++
			return &fakeCLIProvider{}, nil
		},
		now:      time.Now,
		newRunID: func() string { return "budget-blocked" },
	})
	if err != nil {
		t.Fatal(err)
	}
	if loadCalls != 0 {
		t.Fatalf("budget-rejected run loaded provider %d times", loadCalls)
	}
	record, err := evalbench.DecodeBaselineRunRecord(stdout.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if record.ExitReason != evalbench.ExitBudgetRejected ||
		record.ProviderCalls != 0 ||
		record.Cost.WorstCaseMicroUSD <= record.Budget.MaxCostMicroUSD {
		t.Fatalf("unexpected budget rejection record: %#v", record)
	}
}

func writeSyntheticFixture(t *testing.T) (string, string, string) {
	t.Helper()
	root, err := filepath.Abs(filepath.Join(
		"..", "..", "internal", "evalbench", "testdata", "synthetic",
	))
	if err != nil {
		t.Fatal(err)
	}
	prompt := "A plain text word puzzle. Return the uppercase spelling of milk."
	admissionPath := filepath.Join(root, "admission.json")
	return root, admissionPath, prompt
}

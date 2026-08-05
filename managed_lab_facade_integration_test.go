package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/labmanager"
	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

func TestManagedLabFacadeCreatesScopedCTFWorkspaceAndRecordsOracleReceipt(t *testing.T) {
	if os.Getenv("MILKSU_LAB_INTEGRATION") != "1" {
		t.Skip("set MILKSU_LAB_INTEGRATION=1 to run the real Docker lifecycle")
	}

	dataDirectory := t.TempDir()
	managedLabs, err := labmanager.New(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	runtimeService, err := securityruntime.NewService(filepath.Join(dataDirectory, "runtime"), nil)
	if err != nil {
		t.Fatal(err)
	}
	ctfService, err := ctf.NewService(runtimeService, ctf.ServiceOptions{
		Engine: deferredIntegrationEngine{},
	})
	if err != nil {
		_ = runtimeService.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = ctfService.Close()
		_ = runtimeService.Close()
	})

	app := &App{
		ctx:           context.Background(),
		dataDirectory: dataDirectory,
		managedLabs:   managedLabs,
		jobs:          runtimeService,
		ctfJobs:       ctfService,
	}
	app.ctfAgent = newCTFAgentRecorder(
		filepath.Join(dataDirectory, "ctf-workspaces"),
		ctfService,
		nil,
	)

	started, err := app.StartManagedLab(labmanager.JuiceShopPackageID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = app.DestroyManagedLab(started.InstanceID)
	})

	training, err := app.StartManagedLabTraining(started.InstanceID, "copilot")
	if err != nil {
		t.Fatal(err)
	}
	if training.CTF.Challenge.Source.Kind != "local-lab" ||
		training.CTF.Challenge.Source.URI != started.InstanceID ||
		training.Handoff.JobID != training.CTF.Job.ID ||
		training.Handoff.WorkspacePath == "" {
		t.Fatalf("managed lab did not create a traceable CTF workspace: %#v", training)
	}
	if !containsManagedLabTool(training.Handoff.Policy.AllowedTools, "ctf_http") {
		t.Fatalf("managed lab workspace lacks the bounded HTTP ability: %#v", training.Handoff.Policy)
	}
	if !containsManagedLabTarget(
		training.CTF.Challenge.Source.Scope.Targets,
		securitypolicy.TargetOrigin,
		started.Endpoint,
	) {
		t.Fatalf("managed lab workspace lost its exact loopback origin: %#v", training.CTF.Challenge.Source.Scope)
	}

	receipt, err := app.CheckManagedLabTraining(started.InstanceID, training.CTF.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !receipt.Result.Completed || receipt.Result.Solved ||
		receipt.Result.PackageID != labmanager.JuiceShopPackageID ||
		receipt.CTF.Job.Status == securityruntime.JobSucceeded {
		t.Fatalf("fresh Juice Shop oracle produced an invalid training result: %#v", receipt)
	}
	if len(receipt.CTF.Evidence) == 0 || len(receipt.CTF.Evaluations) == 0 {
		t.Fatalf("managed lab oracle did not enter the CTF evidence chain: %#v", receipt.CTF)
	}
}

func containsManagedLabTool(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

func containsManagedLabTarget(
	values []securitypolicy.Target,
	kind securitypolicy.TargetKind,
	wanted string,
) bool {
	for _, value := range values {
		if value.Kind == kind && value.Value == wanted {
			return true
		}
	}
	return false
}

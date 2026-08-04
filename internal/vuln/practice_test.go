package vuln

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type recordingPracticeRunner struct {
	calls []recordedPracticeCall
}

type recordedPracticeCall struct {
	executable  string
	args        []string
	environment []string
	directory   string
}

func (r *recordingPracticeRunner) Run(
	_ context.Context,
	executable string,
	args []string,
	environment []string,
	directory string,
) ([]byte, error) {
	r.calls = append(r.calls, recordedPracticeCall{
		executable:  executable,
		args:        append([]string{}, args...),
		environment: append([]string{}, environment...),
		directory:   directory,
	})
	joined := strings.Join(args, " ")
	switch {
	case joined == "version --format {{.Server.Version}}":
		return []byte("29.4.3\n"), nil
	case strings.Contains(joined, " config --quiet"):
		return nil, nil
	case strings.Contains(joined, " up --detach --remove-orphans"):
		return []byte("Container milksu-cve-fixture Started\n"), nil
	case strings.Contains(joined, " ps --format json"):
		return []byte(`{"Name":"milksu-cve-fixture-learner-1","Service":"learner","State":"running","Health":""}` + "\n"), nil
	case strings.Contains(joined, " down --remove-orphans"):
		return []byte("Container milksu-cve-fixture Removed\n"), nil
	default:
		return nil, nil
	}
}

func TestPracticeEnvironmentStartUsesBoundedDockerComposeAndPersistsEvidence(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "sk-practice-test-secret12345")
	directory := t.TempDir()
	writePracticeCompose(t, directory, `
services:
  learner:
    image: debian:12-slim
    command: ["sh", "-c", "while true; do sleep 5; done"]
networks:
  default:
    internal: true
`)
	runner := &recordingPracticeRunner{}
	report, err := runPracticeEnvironment(context.Background(), t.TempDir(), PracticeRequest{
		CVEID:         "CVE-2023-46604",
		EnvironmentID: "vulhub-cve-2023-46604",
		Directory:     directory,
		ProjectName:   "milksu-cve-fixture",
	}, "start", runner)
	if err != nil {
		t.Fatal(err)
	}
	if report.Schema != PracticeRunSchema ||
		report.State != "running" ||
		!report.Gates.DockerAvailable ||
		!report.Gates.ComposeFileValidated ||
		!report.Gates.Started ||
		!report.Gates.StatusObserved ||
		!report.Gates.NoCredentialLeak ||
		report.ContainerCount != 1 {
		t.Fatalf("unexpected practice report: %#v", report)
	}
	if report.EvidencePath == "" {
		t.Fatal("expected persisted evidence path")
	}
	info, err := os.Stat(report.EvidencePath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("evidence permissions = %o, want 0600", info.Mode().Perm())
	}
	if len(runner.calls) < 4 {
		t.Fatalf("expected docker version/config/up/ps calls, got %d", len(runner.calls))
	}
	for _, call := range runner.calls {
		executable := filepath.Base(call.executable)
		if executable != "docker" && executable != "docker-compose" {
			t.Fatalf("unexpected executable: %s", call.executable)
		}
		joinedEnv := strings.Join(call.environment, "\n")
		if strings.Contains(joinedEnv, "OPENAI_API_KEY") || strings.Contains(joinedEnv, "sk-practice-test-secret") {
			t.Fatalf("practice command inherited provider credential: %s", joinedEnv)
		}
		if call.directory != report.Directory {
			t.Fatalf("docker command dir = %q, want %q", call.directory, report.Directory)
		}
	}
	joinedArgs := strings.Join(runner.calls[2].args, " ")
	if !strings.Contains(joinedArgs, "--project-name milksu-cve-fixture") ||
		!strings.Contains(joinedArgs, "--file "+report.ComposeFile) ||
		!strings.Contains(joinedArgs, "up --detach --remove-orphans") {
		t.Fatalf("start args did not use bounded compose invocation: %s", joinedArgs)
	}
}

func TestPracticeEnvironmentStopUsesComposeDownWithVolumes(t *testing.T) {
	directory := t.TempDir()
	writePracticeCompose(t, directory, `
services:
  learner:
    image: debian:12-slim
    command: ["sh", "-c", "while true; do sleep 5; done"]
`)
	runner := &recordingPracticeRunner{}
	report, err := runPracticeEnvironment(context.Background(), t.TempDir(), PracticeRequest{
		CVEID:          "CVE-2023-46604",
		EnvironmentID:  "vulhub-cve-2023-46604",
		Directory:      directory,
		ProjectName:    "milksu-cve-fixture",
		CleanupVolumes: true,
	}, "stop", runner)
	if err != nil {
		t.Fatal(err)
	}
	if report.State != "stopped" || !report.Gates.Stopped || !report.Gates.NoCredentialLeak {
		t.Fatalf("unexpected stop report: %#v", report)
	}
	joinedArgs := strings.Join(runner.calls[len(runner.calls)-1].args, " ")
	if !strings.Contains(joinedArgs, "down --remove-orphans --volumes") {
		t.Fatalf("stop args did not remove volumes: %s", joinedArgs)
	}
}

func TestPracticeEnvironmentRejectsUnsafeCompose(t *testing.T) {
	for name, compose := range map[string]string{
		"host-network": `
services:
  app:
    image: debian:12-slim
    network_mode: host
`,
		"privileged": `
services:
  app:
    image: debian:12-slim
    privileged: true
`,
		"docker-socket": `
services:
  app:
    image: debian:12-slim
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
`,
	} {
		t.Run(name, func(t *testing.T) {
			directory := t.TempDir()
			writePracticeCompose(t, directory, compose)
			_, err := resolvePracticeRequest(PracticeRequest{
				CVEID:         "CVE-2023-46604",
				EnvironmentID: "unsafe",
				Directory:     directory,
			})
			if err == nil {
				t.Fatal("unsafe compose was accepted")
			}
		})
	}
}

func writePracticeCompose(t *testing.T, directory string, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(directory, "docker-compose.yml"), []byte(strings.TrimSpace(body)+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}

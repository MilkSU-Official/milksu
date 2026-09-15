package evalsuite

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/evalsuite/tasks"
)

func gradeDocker(ctx context.Context, task Task, session *dockerSession, workspace string) (Grade, error) {
	if task.Suite == SuiteCyberGym {
		return gradeCyberGym(ctx, workspace)
	}
	if session == nil {
		return Grade{Total: 1}, nil
	}
	switch task.Source {
	case "deepswe":
		return gradeDeepSWE(ctx, task, session, workspace)
	default:
		return gradeTerminalBench(ctx, task, session, workspace)
	}
}

func gradeTerminalBench(ctx context.Context, task Task, session *dockerSession, workspace string) (Grade, error) {
	verifyDir, err := os.MkdirTemp(workspace, ".judge-")
	if err != nil {
		return Grade{}, err
	}
	logs := filepath.Join(verifyDir, "logs")
	if err := os.MkdirAll(logs, 0o700); err != nil {
		return Grade{}, err
	}
	if err := materializeTests(task, filepath.Join(verifyDir, "tests")); err != nil {
		return Grade{Total: 1}, nil
	}
	args := []string{
		"run", "--rm",
		"-v", workspace + ":/app",
		"-v", filepath.Join(verifyDir, "tests") + ":/tests",
		"-v", logs + ":/logs/verifier",
		"-w", "/app",
		"--entrypoint", "bash",
		task.DockerImage,
		"/tests/test.sh",
	}
	verifyCtx := ctx
	if task.VerifierTimeout > 0 {
		var cancel context.CancelFunc
		verifyCtx, cancel = context.WithTimeout(ctx, task.VerifierTimeout)
		defer cancel()
	}
	_, _ = dockerOutput(verifyCtx, args...)
	_ = session
	return Grade{Score: boolScore(readReward(logs)), Hits: boolHit(readReward(logs)), Total: 1}, nil
}

func gradeDeepSWE(ctx context.Context, task Task, session *dockerSession, workspace string) (Grade, error) {
	base := deepSWEBaseCommit(task)
	collect := "mkdir -p /logs/artifacts && git config --global --add safe.directory /app && git diff --binary"
	if base != "" {
		collect += " " + base + " HEAD"
	} else {
		collect += " HEAD"
	}
	collect += " > /logs/artifacts/model.patch || true"
	if _, err := session.exec(ctx, collect); err != nil {
		return Grade{Total: 1}, nil
	}
	verifyDir, err := os.MkdirTemp(workspace, ".judge-")
	if err != nil {
		return Grade{}, err
	}
	artifacts := filepath.Join(verifyDir, "artifacts")
	logs := filepath.Join(verifyDir, "logs")
	if err := os.MkdirAll(artifacts, 0o700); err != nil {
		return Grade{}, err
	}
	if err := os.MkdirAll(logs, 0o700); err != nil {
		return Grade{}, err
	}
	_ = session.copyFrom(ctx, "/logs/artifacts/model.patch", filepath.Join(artifacts, "model.patch"))
	testsDir := filepath.Join(verifyDir, "tests")
	if err := materializeTests(task, testsDir); err != nil {
		return Grade{Total: 1}, nil
	}
	image := "milksu-eval-ver-" + strings.Map(func(r rune) rune {
		if r == ':' || r == '/' {
			return '-'
		}
		return r
	}, task.Slug)
	if _, err := dockerOutput(ctx, "build", "-t", image, testsDir); err != nil {
		return Grade{Total: 1}, nil
	}
	args := []string{
		"run", "--rm",
		"-v", artifacts + ":/logs/artifacts",
		"-v", logs + ":/logs/verifier",
		image,
		"/tests/test.sh",
	}
	verifyCtx := ctx
	if task.VerifierTimeout > 0 {
		var cancel context.CancelFunc
		verifyCtx, cancel = context.WithTimeout(ctx, task.VerifierTimeout)
		defer cancel()
	}
	_, _ = dockerOutput(verifyCtx, args...)
	ok := readReward(logs)
	return Grade{Score: boolScore(ok), Hits: boolHit(ok), Total: 1}, nil
}

func gradeCyberGym(_ context.Context, workspace string) (Grade, error) {
	receipt := filepath.Join(workspace, "submit-receipt.json")
	data, err := os.ReadFile(receipt)
	if err != nil {
		return Grade{Total: 1}, nil
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return Grade{Total: 1}, nil
	}
	vuln, _ := asInt(payload["vul_exit_code"])
	fix, _ := asInt(payload["fix_exit_code"])
	ok := vuln != 0 && fix == 0
	return Grade{Score: boolScore(ok), Hits: boolHit(ok), Total: 1}, nil
}

func materializeTests(task Task, dest string) error {
	if strings.TrimSpace(task.TestsDir) == "" {
		return fmt.Errorf("no tests")
	}
	entries, err := fsReadDir(task.TestsDir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dest, 0o700); err != nil {
		return err
	}
	for _, name := range entries {
		data, readErr := tasks.FS.ReadFile(task.TestsDir + "/" + name)
		if readErr != nil {
			continue
		}
		path := filepath.Join(dest, name)
		if err := os.WriteFile(path, data, 0o700); err != nil {
			return err
		}
	}
	return nil
}

func fsReadDir(dir string) ([]string, error) {
	entries, err := tasks.FS.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		names = append(names, entry.Name())
	}
	if len(names) == 0 {
		return nil, fmt.Errorf("empty tests")
	}
	return names, nil
}

func deepSWEBaseCommit(task Task) string {
	raw, err := tasks.FS.ReadFile(task.TestsDir + "/config.json")
	if err != nil {
		return ""
	}
	var payload struct {
		BaseCommit string `json:"base_commit"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return ""
	}
	return strings.TrimSpace(payload.BaseCommit)
}

func readReward(logs string) bool {
	if data, err := os.ReadFile(filepath.Join(logs, "reward.txt")); err == nil {
		text := strings.TrimSpace(string(data))
		if text == "1" {
			return true
		}
	}
	data, err := os.ReadFile(filepath.Join(logs, "reward.json"))
	if err != nil {
		return false
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return false
	}
	switch value := payload["reward"].(type) {
	case float64:
		return value == 1
	case int:
		return value == 1
	case string:
		return value == "1"
	default:
		return false
	}
}

func boolScore(ok bool) float64 {
	if ok {
		return 1
	}
	return 0
}

func boolHit(ok bool) int {
	if ok {
		return 1
	}
	return 0
}

func asInt(value any) (int, bool) {
	switch typed := value.(type) {
	case float64:
		return int(typed), true
	case int:
		return typed, true
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(typed))
		return n, err == nil
	default:
		return 0, false
	}
}

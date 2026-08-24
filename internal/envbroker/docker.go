package envbroker

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type composeRunner interface {
	LookPath(name string) (string, error)
	Run(ctx context.Context, executable string, args []string, directory string) ([]byte, error)
}

type execComposeRunner struct{}

func (execComposeRunner) LookPath(name string) (string, error) {
	return exec.LookPath(name)
}

func (execComposeRunner) Run(ctx context.Context, executable string, args []string, directory string) ([]byte, error) {
	command := exec.CommandContext(ctx, executable, args...)
	command.Dir = directory
	command.Env = os.Environ()
	return command.CombinedOutput()
}

func dockerAvailable(runner composeRunner) error {
	docker, err := findDocker(runner)
	if err != nil {
		return fmt.Errorf("Docker CLI 不可用")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if output, runErr := runner.Run(ctx, docker, []string{"version", "--format", "{{.Server.Version}}"}, ""); runErr != nil {
		return fmt.Errorf("Docker 未运行: %s", strings.TrimSpace(string(output)))
	}
	return nil
}

func waitHTTPReady(ctx context.Context, address string) {
	target := address
	if !strings.Contains(target, "://") {
		target = "http://" + target
	}
	client := &http.Client{Timeout: 2 * time.Second}
	deadline := time.Now().Add(45 * time.Second)
	for time.Now().Before(deadline) {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if err != nil {
			return
		}
		response, err := client.Do(request)
		if err == nil {
			_ = response.Body.Close()
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(800 * time.Millisecond):
		}
	}
}

func startCompose(ctx context.Context, runner composeRunner, directory, project string) error {
	docker, composeArgs, err := composeInvocation(runner)
	if err != nil {
		return err
	}
	args := append(append([]string{}, composeArgs...), "--project-name", project, "--file", "compose.yaml", "up", "--detach", "--remove-orphans")
	commandContext, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	output, runErr := runner.Run(commandContext, docker, args, directory)
	if runErr != nil {
		return fmt.Errorf("启动容器失败: %s", strings.TrimSpace(string(output)))
	}
	return nil
}

func composeStatus(ctx context.Context, runner composeRunner, directory, project string) (string, error) {
	docker, composeArgs, err := composeInvocation(runner)
	if err != nil {
		return "unknown", err
	}
	args := append(append([]string{}, composeArgs...), "--project-name", project, "--file", "compose.yaml", "ps", "--format", "{{.State}}")
	commandContext, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	output, runErr := runner.Run(commandContext, docker, args, directory)
	if runErr != nil {
		return "unknown", fmt.Errorf("查询容器失败: %s", strings.TrimSpace(string(output)))
	}
	text := strings.ToLower(strings.TrimSpace(string(output)))
	if strings.Contains(text, "running") {
		return "ready", nil
	}
	if text == "" {
		return "stopped", nil
	}
	return "stopped", nil
}

func stopCompose(ctx context.Context, runner composeRunner, directory, project string) error {
	docker, composeArgs, err := composeInvocation(runner)
	if err != nil {
		return err
	}
	args := append(append([]string{}, composeArgs...), "--project-name", project, "--file", "compose.yaml", "down", "--remove-orphans")
	commandContext, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	output, runErr := runner.Run(commandContext, docker, args, directory)
	if runErr != nil {
		return fmt.Errorf("停止容器失败: %s", strings.TrimSpace(string(output)))
	}
	return nil
}

func composeInvocation(runner composeRunner) (string, []string, error) {
	docker, err := findDocker(runner)
	if err != nil {
		return "", nil, err
	}
	if _, err := runner.LookPath("docker-compose"); err == nil {
		path, _ := runner.LookPath("docker-compose")
		return path, nil, nil
	}
	return docker, []string{"compose", "--ansi", "never"}, nil
}

func findDocker(runner composeRunner) (string, error) {
	if path, err := runner.LookPath("docker"); err == nil {
		return path, nil
	}
	for _, candidate := range []string{
		"/usr/local/bin/docker",
		"/opt/homebrew/bin/docker",
		"/Applications/Docker.app/Contents/Resources/bin/docker",
	} {
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0o111 != 0 {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("docker executable was not found")
}

func materializeCompose(dataDirectory string, owner Owner, item Package) (string, error) {
	data, err := composeBytes(item)
	if err != nil {
		return "", err
	}
	if len(data) == 0 {
		return "", fmt.Errorf("package %s has no compose file", item.ID)
	}
	directory := filepath.Join(dataDirectory, "envbroker", "instances", sanitizeOwner(owner), item.ID)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(directory, "compose.yaml")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", err
	}
	return directory, nil
}

func sanitizeOwner(owner Owner) string {
	raw := owner.Kind + "-" + owner.ID
	var b strings.Builder
	for _, r := range strings.ToLower(raw) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteByte('-')
		}
	}
	out := b.String()
	if out == "" {
		return "job"
	}
	if len(out) > 80 {
		return out[:80]
	}
	return out
}

func projectName(item Package) string {
	return "milksu-env-" + item.ID
}

package evalsuite

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type dockerExec struct {
	LookPath func(string) (string, error)
	Run      func(ctx context.Context, name string, args ...string) ([]byte, error)
}

var (
	dockerMu      sync.Mutex
	dockerChecked time.Time
	dockerErr     error
	dockerBin     string
	liveDocker    = dockerExec{
		LookPath: exec.LookPath,
		Run: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			cmd := exec.CommandContext(ctx, name, args...)
			cmd.Env = os.Environ()
			return cmd.CombinedOutput()
		},
	}
)

func dockerAvailable() error {
	dockerMu.Lock()
	defer dockerMu.Unlock()
	if time.Since(dockerChecked) < 15*time.Second && dockerChecked != (time.Time{}) {
		return dockerErr
	}
	bin, err := findDocker(liveDocker)
	dockerChecked = time.Now()
	if err != nil {
		dockerBin = ""
		dockerErr = err
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	output, runErr := liveDocker.Run(ctx, bin, "version", "--format", "{{.Server.Version}}")
	if runErr != nil {
		dockerBin = ""
		dockerErr = fmt.Errorf("Docker 未运行")
		_ = output
		return dockerErr
	}
	dockerBin = bin
	dockerErr = nil
	return nil
}

func findDocker(cli dockerExec) (string, error) {
	if path, err := cli.LookPath("docker"); err == nil {
		return path, nil
	}
	home, _ := os.UserHomeDir()
	candidates := []string{
		"/usr/local/bin/docker",
		"/opt/homebrew/bin/docker",
		"/Applications/Docker.app/Contents/Resources/bin/docker",
	}
	if home != "" {
		candidates = append(candidates,
			filepath.Join(home, ".docker", "bin", "docker"),
		)
	}
	for _, path := range candidates {
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			return path, nil
		}
	}
	return "", fmt.Errorf("需要 Docker")
}

func currentDockerBin() string {
	dockerMu.Lock()
	defer dockerMu.Unlock()
	return dockerBin
}

func dockerOutput(ctx context.Context, args ...string) ([]byte, error) {
	bin := currentDockerBin()
	if bin == "" {
		if err := dockerAvailable(); err != nil {
			return nil, err
		}
		bin = currentDockerBin()
	}
	if bin == "" {
		return nil, fmt.Errorf("需要 Docker")
	}
	output, err := liveDocker.Run(ctx, bin, args...)
	if err != nil {
		detail := strings.TrimSpace(string(output))
		if detail == "" {
			return output, err
		}
		return output, fmt.Errorf("%s", clip(detail, 400))
	}
	return output, nil
}

func dockerName(slug string) string {
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			return r
		case r == '-', r == '_':
			return r
		default:
			return '-'
		}
	}, slug)
	cleaned = strings.Trim(cleaned, "-")
	if cleaned == "" {
		cleaned = "task"
	}
	if len(cleaned) > 40 {
		cleaned = cleaned[:40]
	}
	return fmt.Sprintf("milksu-eval-%s-%d", cleaned, nowMillis()%100000)
}

type dockerSession struct {
	Name      string
	Workspace string
	Image     string
	Workdir   string
}

func startDockerWorkspace(ctx context.Context, task Task, workspace string, progress func(string)) (*dockerSession, func(), error) {
	if strings.TrimSpace(task.DockerImage) == "" {
		return nil, func() {}, fmt.Errorf("该题没有镜像")
	}
	if err := os.MkdirAll(workspace, 0o700); err != nil {
		return nil, func() {}, err
	}
	if progress != nil {
		progress("正在拉取镜像")
	}
	if _, err := dockerOutput(ctx, "pull", task.DockerImage); err != nil {
		return nil, func() {}, fmt.Errorf("拉取镜像失败: %w", err)
	}
	seed := dockerName(task.Slug + "-seed")
	if _, err := dockerOutput(ctx, "create", "--name", seed, task.DockerImage); err != nil {
		return nil, func() {}, err
	}
	_, copyErr := dockerOutput(ctx, "cp", seed+":/app/.", workspace)
	_, _ = dockerOutput(context.Background(), "rm", "-f", seed)
	if copyErr != nil {
		_ = os.MkdirAll(workspace, 0o700)
	}
	name := dockerName(task.Slug)
	memory := task.MemoryMB
	if memory <= 0 {
		memory = 2048
	}
	cpus := task.CPUs
	if cpus <= 0 {
		cpus = 1
	}
	args := []string{
		"run", "-d", "--name", name,
		"--network", "none",
		"--memory", fmt.Sprintf("%dm", memory),
		"--cpus", fmt.Sprintf("%.2f", cpus),
		"-v", workspace + ":/app",
		"-w", "/app",
		"--entrypoint", "sleep",
		task.DockerImage,
		"86400",
	}
	if _, err := dockerOutput(ctx, args...); err != nil {
		return nil, func() {}, err
	}
	session := &dockerSession{Name: name, Workspace: workspace, Image: task.DockerImage, Workdir: "/app"}
	if err := writeEvalShell(session); err != nil {
		session.close()
		return nil, func() {}, err
	}
	return session, session.close, nil
}

func (s *dockerSession) close() {
	if s == nil || s.Name == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	_, _ = dockerOutput(ctx, "rm", "-f", s.Name)
}

func (s *dockerSession) exec(ctx context.Context, command string) ([]byte, error) {
	return dockerOutput(ctx, "exec", "-w", s.Workdir, s.Name, "bash", "-lc", command)
}

func (s *dockerSession) copyFrom(ctx context.Context, src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
		return err
	}
	_, err := dockerOutput(ctx, "cp", s.Name+":"+src, dst)
	return err
}

func writeEvalShell(session *dockerSession) error {
	dir := filepath.Join(session.Workspace, ".milksu-eval")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	bin := currentDockerBin()
	if err := os.WriteFile(filepath.Join(dir, "container"), []byte(session.Name+"\n"), 0o600); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "docker"), []byte(bin+"\n"), 0o600); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "workdir"), []byte(session.Workdir+"\n"), 0o600); err != nil {
		return err
	}
	script := "#!/bin/sh\n" +
		"DIR=$(CDPATH= cd -- \"$(dirname \"$0\")\" && pwd)\n" +
		"ID=$(tr -d '\\n' < \"$DIR/container\")\n" +
		"DOCKER=$(tr -d '\\n' < \"$DIR/docker\")\n" +
		"WORKDIR=$(tr -d '\\n' < \"$DIR/workdir\")\n" +
		"exec \"$DOCKER\" exec -i -w \"$WORKDIR\" \"$ID\" bash \"$@\"\n"
	path := filepath.Join(dir, "bash")
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		return err
	}
	return nil
}

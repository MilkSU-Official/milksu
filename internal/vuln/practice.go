package vuln

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	PracticeRunSchema = "milksu-vuln-practice-run/v1"
	maxComposeBytes   = 2 << 20
	maxCommandBytes   = 12 << 10
)

var practiceProjectPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,62}$`)

type PracticeRequest struct {
	CVEID          string `json:"cveId"`
	EnvironmentID  string `json:"environmentId"`
	Directory      string `json:"directory"`
	SourceRevision string `json:"sourceRevision,omitempty"`
	ProjectName    string `json:"projectName,omitempty"`
	CleanupVolumes bool   `json:"cleanupVolumes,omitempty"`
}

type PracticeRun struct {
	Schema           string                   `json:"schema"`
	Action           string                   `json:"action"`
	State            string                   `json:"state"`
	CVEID            string                   `json:"cveId"`
	EnvironmentID    string                   `json:"environmentId"`
	Directory        string                   `json:"directory"`
	ComposeFile      string                   `json:"composeFile"`
	ProjectName      string                   `json:"projectName"`
	SourceRevision   string                   `json:"sourceRevision,omitempty"`
	ObservedAt       string                   `json:"observedAt"`
	EvidencePath     string                   `json:"evidencePath,omitempty"`
	ComposeSHA256    string                   `json:"composeSha256,omitempty"`
	ContainerCount   int                      `json:"containerCount"`
	Containers       []PracticeContainer      `json:"containers,omitempty"`
	CommandSummaries []PracticeCommandSummary `json:"commandSummaries,omitempty"`
	Gates            PracticeRunGates         `json:"gates"`
	Limitations      []string                 `json:"limitations,omitempty"`
	Error            string                   `json:"error,omitempty"`
}

type PracticeRunGates struct {
	DockerAvailable      bool `json:"dockerAvailable"`
	ComposeFileValidated bool `json:"composeFileValidated"`
	Started              bool `json:"started"`
	StatusObserved       bool `json:"statusObserved"`
	Stopped              bool `json:"stopped"`
	NoCredentialLeak     bool `json:"noCredentialLeak"`
}

type PracticeContainer struct {
	Name    string `json:"name,omitempty"`
	Service string `json:"service,omitempty"`
	State   string `json:"state,omitempty"`
	Health  string `json:"health,omitempty"`
}

type PracticeCommandSummary struct {
	Name       string   `json:"name"`
	Args       []string `json:"args"`
	ExitCode   int      `json:"exitCode"`
	Output     string   `json:"output,omitempty"`
	OutputHash string   `json:"outputSha256,omitempty"`
}

type practiceCommandRunner interface {
	Executables() (string, string, []string, error)
	Run(context.Context, string, []string, []string, string) ([]byte, error)
}

type dockerPracticeRunner struct{}

func (dockerPracticeRunner) Executables() (string, string, []string, error) {
	return findDockerPracticeExecutables()
}

func (dockerPracticeRunner) Run(
	ctx context.Context,
	executable string,
	args []string,
	environment []string,
	directory string,
) ([]byte, error) {
	command := exec.CommandContext(ctx, executable, args...)
	command.Dir = directory
	command.Env = environment
	return command.CombinedOutput()
}

type resolvedPracticeRequest struct {
	request     PracticeRequest
	directory   string
	composeFile string
	composeHash string
	projectName string
}

func StartPracticeEnvironment(ctx context.Context, dataDirectory string, request PracticeRequest) (PracticeRun, error) {
	return runPracticeEnvironment(ctx, dataDirectory, request, "start", dockerPracticeRunner{})
}

func GetPracticeEnvironmentStatus(ctx context.Context, dataDirectory string, request PracticeRequest) (PracticeRun, error) {
	return runPracticeEnvironment(ctx, dataDirectory, request, "status", dockerPracticeRunner{})
}

func StopPracticeEnvironment(ctx context.Context, dataDirectory string, request PracticeRequest) (PracticeRun, error) {
	return runPracticeEnvironment(ctx, dataDirectory, request, "stop", dockerPracticeRunner{})
}

func runPracticeEnvironment(
	ctx context.Context,
	dataDirectory string,
	request PracticeRequest,
	action string,
	runner practiceCommandRunner,
) (PracticeRun, error) {
	resolved, err := resolvePracticeRequest(request)
	run := newPracticeRun(action, resolved)
	if err != nil {
		run = newPracticeRun(action, resolvedPracticeRequest{request: request})
		run.Error = err.Error()
		run.Gates.NoCredentialLeak = !practiceRunContainsSensitiveShape(run)
		_ = persistPracticeRun(dataDirectory, &run)
		return run, err
	}
	run = newPracticeRun(action, resolved)
	environment := practiceCommandEnvironment()

	dockerExecutable, composeExecutable, composePrefix, err := runner.Executables()
	if err != nil {
		run.Error = "Docker CLI is unavailable"
		run.Gates.NoCredentialLeak = !practiceRunContainsSensitiveShape(run)
		_ = persistPracticeRun(dataDirectory, &run)
		return run, fmt.Errorf("start vulnerability practice: docker CLI unavailable: %w", err)
	}

	composeArgs := func(args ...string) []string {
		prefix := append([]string{}, composePrefix...)
		prefix = append(prefix, "--ansi", "never", "--project-name", resolved.projectName, "--file", resolved.composeFile)
		return append(prefix, args...)
	}
	runDocker := func(name string, args []string) ([]byte, error) {
		commandContext, cancel := context.WithTimeout(ctx, 2*time.Minute)
		defer cancel()
		output, runErr := runner.Run(commandContext, dockerExecutable, args, environment, resolved.directory)
		run.CommandSummaries = append(run.CommandSummaries, summarizePracticeCommand(name, args, output, runErr))
		return output, runErr
	}
	runCompose := func(name string, args []string) ([]byte, error) {
		commandContext, cancel := context.WithTimeout(ctx, 2*time.Minute)
		defer cancel()
		output, runErr := runner.Run(commandContext, composeExecutable, args, environment, resolved.directory)
		run.CommandSummaries = append(run.CommandSummaries, summarizePracticeCommand(name, args, output, runErr))
		return output, runErr
	}

	if output, runErr := runDocker("docker version", []string{"version", "--format", "{{.Server.Version}}"}); runErr != nil {
		run.Error = "Docker daemon is unavailable"
		run.Gates.NoCredentialLeak = !practiceRunContainsSensitiveShape(run)
		_ = persistPracticeRun(dataDirectory, &run)
		return run, fmt.Errorf("check Docker daemon: %w: %s", runErr, strings.TrimSpace(string(output)))
	}
	run.Gates.DockerAvailable = true

	if output, runErr := runCompose("docker compose config", composeArgs("config", "--quiet")); runErr != nil {
		run.Error = "Docker Compose rejected the selected practice directory"
		run.Gates.NoCredentialLeak = !practiceRunContainsSensitiveShape(run)
		_ = persistPracticeRun(dataDirectory, &run)
		return run, fmt.Errorf("validate vulnerability practice compose: %w: %s", runErr, strings.TrimSpace(string(output)))
	}
	run.Gates.ComposeFileValidated = true

	switch action {
	case "start":
		if output, runErr := runCompose("docker compose up", composeArgs("up", "--detach", "--remove-orphans")); runErr != nil {
			run.State = "failed"
			run.Error = "Docker Compose failed to start the practice environment"
			run.Gates.NoCredentialLeak = !practiceRunContainsSensitiveShape(run)
			_ = persistPracticeRun(dataDirectory, &run)
			return run, fmt.Errorf("start vulnerability practice compose: %w: %s", runErr, strings.TrimSpace(string(output)))
		}
		run.State = "running"
		run.Gates.Started = true
		if output, runErr := runCompose("docker compose ps", composeArgs("ps", "--format", "json")); runErr == nil {
			run.Containers = parsePracticeContainers(output)
			run.ContainerCount = len(run.Containers)
			run.Gates.StatusObserved = true
		}
	case "status":
		output, runErr := runCompose("docker compose ps", composeArgs("ps", "--format", "json"))
		if runErr != nil {
			run.State = "unknown"
			run.Error = "Docker Compose status failed"
			run.Gates.NoCredentialLeak = !practiceRunContainsSensitiveShape(run)
			_ = persistPracticeRun(dataDirectory, &run)
			return run, fmt.Errorf("inspect vulnerability practice compose: %w: %s", runErr, strings.TrimSpace(string(output)))
		}
		run.Containers = parsePracticeContainers(output)
		run.ContainerCount = len(run.Containers)
		run.State = practiceStateFromContainers(run.Containers)
		run.Gates.StatusObserved = true
	case "stop":
		args := composeArgs("down", "--remove-orphans")
		if request.CleanupVolumes {
			args = append(args, "--volumes")
		}
		if output, runErr := runCompose("docker compose down", args); runErr != nil {
			run.State = "failed"
			run.Error = "Docker Compose failed to stop the practice environment"
			run.Gates.NoCredentialLeak = !practiceRunContainsSensitiveShape(run)
			_ = persistPracticeRun(dataDirectory, &run)
			return run, fmt.Errorf("stop vulnerability practice compose: %w: %s", runErr, strings.TrimSpace(string(output)))
		}
		run.State = "stopped"
		run.Gates.Stopped = true
		run.Gates.StatusObserved = true
	default:
		run.Error = fmt.Sprintf("unsupported vulnerability practice action %q", action)
		run.Gates.NoCredentialLeak = !practiceRunContainsSensitiveShape(run)
		_ = persistPracticeRun(dataDirectory, &run)
		return run, fmt.Errorf("unsupported vulnerability practice action %q", action)
	}
	run.Gates.NoCredentialLeak = !practiceRunContainsSensitiveShape(run)
	if err := persistPracticeRun(dataDirectory, &run); err != nil {
		return run, err
	}
	return run, nil
}

func findDockerPracticeExecutables() (string, string, []string, error) {
	dockerExecutable, err := findDockerExecutable()
	if err != nil {
		return "", "", nil, err
	}
	if composeExecutable, err := findDockerComposeExecutable(); err == nil {
		return dockerExecutable, composeExecutable, nil, nil
	}
	return dockerExecutable, dockerExecutable, []string{"compose"}, nil
}

func findDockerExecutable() (string, error) {
	if path, err := exec.LookPath("docker"); err == nil {
		return path, nil
	}
	var firstError error
	for _, candidate := range []string{
		"/usr/local/bin/docker",
		"/opt/homebrew/bin/docker",
		"/Applications/Docker.app/Contents/Resources/bin/docker",
	} {
		info, err := os.Stat(candidate)
		if err != nil {
			if firstError == nil {
				firstError = err
			}
			continue
		}
		if info.Mode().IsRegular() && info.Mode().Perm()&0o111 != 0 {
			return candidate, nil
		}
	}
	if firstError != nil {
		return "", firstError
	}
	return "", fmt.Errorf("docker executable was not found")
}

func findDockerComposeExecutable() (string, error) {
	if path, err := exec.LookPath("docker-compose"); err == nil {
		return path, nil
	}
	candidates := []string{
		"/Applications/Docker.app/Contents/Resources/cli-plugins/docker-compose",
		"/usr/local/lib/docker/cli-plugins/docker-compose",
		"/opt/homebrew/lib/docker/cli-plugins/docker-compose",
	}
	if homeDirectory, err := os.UserHomeDir(); err == nil && homeDirectory != "" {
		candidates = append([]string{filepath.Join(homeDirectory, ".docker", "cli-plugins", "docker-compose")}, candidates...)
	}
	var firstError error
	for _, candidate := range candidates {
		info, err := os.Stat(candidate)
		if err != nil {
			if firstError == nil {
				firstError = err
			}
			continue
		}
		if info.Mode().IsRegular() && info.Mode().Perm()&0o111 != 0 {
			return candidate, nil
		}
	}
	if firstError != nil {
		return "", firstError
	}
	return "", fmt.Errorf("docker compose executable was not found")
}

func newPracticeRun(action string, resolved resolvedPracticeRequest) PracticeRun {
	request := resolved.request
	state := "pending"
	if action == "stop" {
		state = "stopping"
	}
	return PracticeRun{
		Schema:         PracticeRunSchema,
		Action:         action,
		State:          state,
		CVEID:          strings.ToUpper(strings.TrimSpace(request.CVEID)),
		EnvironmentID:  strings.TrimSpace(request.EnvironmentID),
		Directory:      resolved.directory,
		ComposeFile:    resolved.composeFile,
		ProjectName:    resolved.projectName,
		SourceRevision: strings.TrimSpace(request.SourceRevision),
		ObservedAt:     time.Now().UTC().Format(time.RFC3339Nano),
		ComposeSHA256:  resolved.composeHash,
		Limitations: []string{
			"This run only starts, inspects, and stops a local Docker Compose learning environment.",
			"It does not run exploit code, submit vulnerability-triggering input, scan external targets, or prove a real asset is vulnerable.",
		},
	}
}

func resolvePracticeRequest(request PracticeRequest) (resolvedPracticeRequest, error) {
	request.CVEID = strings.ToUpper(strings.TrimSpace(request.CVEID))
	request.EnvironmentID = strings.TrimSpace(request.EnvironmentID)
	request.Directory = strings.TrimSpace(request.Directory)
	request.SourceRevision = strings.TrimSpace(request.SourceRevision)
	request.ProjectName = strings.TrimSpace(request.ProjectName)
	if !cveIDPattern.MatchString(request.CVEID) {
		return resolvedPracticeRequest{request: request}, fmt.Errorf("vulnerability practice requires a valid CVE id")
	}
	if request.EnvironmentID == "" || len([]rune(request.EnvironmentID)) > 160 {
		return resolvedPracticeRequest{request: request}, fmt.Errorf("vulnerability practice requires a bounded environment id")
	}
	if request.Directory == "" {
		return resolvedPracticeRequest{request: request}, fmt.Errorf("vulnerability practice requires a local directory")
	}
	absolute, err := filepath.Abs(request.Directory)
	if err != nil {
		return resolvedPracticeRequest{request: request}, fmt.Errorf("resolve vulnerability practice directory: %w", err)
	}
	resolvedDirectory, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return resolvedPracticeRequest{request: request}, fmt.Errorf("resolve vulnerability practice directory: %w", err)
	}
	info, err := os.Stat(resolvedDirectory)
	if err != nil {
		return resolvedPracticeRequest{request: request}, fmt.Errorf("inspect vulnerability practice directory: %w", err)
	}
	if !info.IsDir() {
		return resolvedPracticeRequest{request: request}, fmt.Errorf("vulnerability practice path must be a directory")
	}
	composeFile, err := findPracticeComposeFile(resolvedDirectory)
	if err != nil {
		return resolvedPracticeRequest{request: request, directory: resolvedDirectory}, err
	}
	composeData, err := os.ReadFile(composeFile)
	if err != nil {
		return resolvedPracticeRequest{request: request, directory: resolvedDirectory, composeFile: composeFile}, fmt.Errorf("read vulnerability practice compose: %w", err)
	}
	if len(composeData) == 0 || len(composeData) > maxComposeBytes {
		return resolvedPracticeRequest{request: request, directory: resolvedDirectory, composeFile: composeFile}, fmt.Errorf("vulnerability practice compose must be 1 byte to %d bytes", maxComposeBytes)
	}
	if err := rejectUnsafePracticeCompose(composeData); err != nil {
		return resolvedPracticeRequest{request: request, directory: resolvedDirectory, composeFile: composeFile}, err
	}
	sum := sha256.Sum256(composeData)
	projectName := request.ProjectName
	if projectName == "" {
		projectName = practiceProjectName(request.CVEID, resolvedDirectory)
	}
	if !practiceProjectPattern.MatchString(projectName) {
		return resolvedPracticeRequest{request: request, directory: resolvedDirectory, composeFile: composeFile}, fmt.Errorf("invalid vulnerability practice compose project name")
	}
	return resolvedPracticeRequest{
		request:     request,
		directory:   resolvedDirectory,
		composeFile: composeFile,
		composeHash: hex.EncodeToString(sum[:]),
		projectName: projectName,
	}, nil
}

func findPracticeComposeFile(directory string) (string, error) {
	for _, name := range []string{"docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"} {
		candidate := filepath.Join(directory, name)
		resolved, err := filepath.EvalSymlinks(candidate)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return "", fmt.Errorf("resolve vulnerability practice compose: %w", err)
		}
		if !strings.HasPrefix(resolved, directory+string(os.PathSeparator)) {
			return "", fmt.Errorf("vulnerability practice compose escapes selected directory")
		}
		info, err := os.Stat(resolved)
		if err != nil {
			return "", fmt.Errorf("inspect vulnerability practice compose: %w", err)
		}
		if info.Mode().IsRegular() {
			return resolved, nil
		}
	}
	return "", fmt.Errorf("vulnerability practice directory must contain docker-compose.yml, docker-compose.yaml, compose.yml, or compose.yaml")
}

func rejectUnsafePracticeCompose(data []byte) error {
	lower := strings.ToLower(string(data))
	for _, forbidden := range []string{
		"network_mode: host",
		"network_mode: \"host\"",
		"network_mode: 'host'",
		"privileged: true",
		"privileged: \"true\"",
		"privileged: 'true'",
		"pid: host",
		"pid: \"host\"",
		"pid: 'host'",
		"/var/run/docker.sock",
	} {
		if strings.Contains(lower, forbidden) {
			return fmt.Errorf("vulnerability practice compose requests unsafe host-level access: %s", forbidden)
		}
	}
	return nil
}

func practiceProjectName(cveID, directory string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(cveID) + "\n" + directory))
	suffix := hex.EncodeToString(sum[:])[:10]
	compactCVE := strings.ToLower(strings.ReplaceAll(cveID, "cve-", ""))
	compactCVE = strings.NewReplacer("_", "-", ".", "-", "/", "-").Replace(compactCVE)
	name := "milksu-cve-" + compactCVE + "-" + suffix
	if len(name) > 63 {
		name = name[:63]
	}
	name = strings.TrimRight(name, "_-")
	if name == "" {
		return "milksu-cve-" + suffix
	}
	return name
}

func practiceCommandEnvironment() []string {
	allowed := []string{
		"PATH", "HOME", "TMPDIR", "LANG", "LC_ALL",
		"DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "XDG_RUNTIME_DIR",
	}
	environment := make([]string, 0, len(allowed))
	for _, name := range allowed {
		if value, ok := os.LookupEnv(name); ok {
			environment = append(environment, name+"="+value)
		}
	}
	return environment
}

func summarizePracticeCommand(name string, args []string, output []byte, runErr error) PracticeCommandSummary {
	exitCode := 0
	if runErr != nil {
		exitCode = 1
		var exitError *exec.ExitError
		if ok := errorAs(runErr, &exitError); ok {
			exitCode = exitError.ExitCode()
		}
	}
	sum := sha256.Sum256(output)
	return PracticeCommandSummary{
		Name:       name,
		Args:       append([]string{}, args...),
		ExitCode:   exitCode,
		Output:     truncatePracticeOutput(redactPracticeText(string(output))),
		OutputHash: hex.EncodeToString(sum[:]),
	}
}

func errorAs(err error, target any) bool {
	switch typed := target.(type) {
	case **exec.ExitError:
		if exit, ok := err.(*exec.ExitError); ok {
			*typed = exit
			return true
		}
	}
	return false
}

func truncatePracticeOutput(value string) string {
	if len(value) <= maxCommandBytes {
		return value
	}
	return value[:maxCommandBytes] + "\n[truncated]"
}

func redactPracticeText(value string) string {
	replacements := []*regexp.Regexp{
		regexp.MustCompile(`(?i)(api[_-]?key\s*[:=]\s*)[^\s"']+`),
		regexp.MustCompile(`(?i)(authorization\s*[:=]\s*bearer\s+)[^\s"']+`),
		regexp.MustCompile(`(?i)(bearer\s+)[A-Za-z0-9._~+/=-]{8,}`),
		regexp.MustCompile(`(?i)(token\s*[:=]\s*)[^\s"']+`),
		regexp.MustCompile(`(?i)(secret\s*[:=]\s*)[^\s"']+`),
		regexp.MustCompile(`(?i)(password\s*[:=]\s*)[^\s"']+`),
		regexp.MustCompile(`sk-[A-Za-z0-9_-]{8,}`),
	}
	redacted := value
	for _, pattern := range replacements {
		redacted = pattern.ReplaceAllString(redacted, `${1}[credential redacted]`)
	}
	return redacted
}

func practiceRunContainsSensitiveShape(run PracticeRun) bool {
	encoded, err := json.Marshal(run)
	if err != nil {
		return true
	}
	lower := strings.ToLower(string(encoded))
	for _, forbidden := range []string{
		"api_key=",
		"api-key=",
		"x-api-key",
		"authorization: bearer",
		"bearer sk-",
		"sk-",
		"password=",
		"secret=",
		"token=",
	} {
		if strings.Contains(lower, forbidden) {
			return true
		}
	}
	return false
}

func parsePracticeContainers(output []byte) []PracticeContainer {
	trimmed := bytes.TrimSpace(output)
	if len(trimmed) == 0 {
		return nil
	}
	var array []map[string]any
	if bytes.HasPrefix(trimmed, []byte("[")) && json.Unmarshal(trimmed, &array) == nil {
		return practiceContainersFromMaps(array)
	}
	lines := bytes.Split(trimmed, []byte("\n"))
	values := make([]map[string]any, 0, len(lines))
	for _, line := range lines {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		var record map[string]any
		if json.Unmarshal(line, &record) == nil {
			values = append(values, record)
		}
	}
	return practiceContainersFromMaps(values)
}

func practiceContainersFromMaps(values []map[string]any) []PracticeContainer {
	containers := make([]PracticeContainer, 0, len(values))
	for _, value := range values {
		container := PracticeContainer{
			Name:    stringFromPracticeMap(value, "Name", "name"),
			Service: stringFromPracticeMap(value, "Service", "service"),
			State:   stringFromPracticeMap(value, "State", "state"),
			Health:  stringFromPracticeMap(value, "Health", "health"),
		}
		if container.Name == "" && container.Service == "" && container.State == "" {
			continue
		}
		containers = append(containers, container)
	}
	return containers
}

func stringFromPracticeMap(value map[string]any, keys ...string) string {
	for _, key := range keys {
		if raw, ok := value[key]; ok {
			switch typed := raw.(type) {
			case string:
				return typed
			case fmt.Stringer:
				return typed.String()
			}
		}
	}
	return ""
}

func practiceStateFromContainers(containers []PracticeContainer) string {
	if len(containers) == 0 {
		return "stopped"
	}
	for _, container := range containers {
		if strings.EqualFold(container.State, "running") {
			return "running"
		}
	}
	return "created"
}

func persistPracticeRun(dataDirectory string, run *PracticeRun) error {
	if strings.TrimSpace(dataDirectory) == "" {
		return nil
	}
	safeCVE := strings.ToLower(strings.ReplaceAll(run.CVEID, "/", "-"))
	if safeCVE == "" {
		safeCVE = "unknown"
	}
	root := filepath.Join(dataDirectory, "vuln", "practice-runs", safeCVE)
	if err := os.MkdirAll(root, 0o700); err != nil {
		return fmt.Errorf("create vulnerability practice evidence directory: %w", err)
	}
	stamp := time.Now().UTC().Format("20060102T150405.000000000Z")
	path := filepath.Join(root, stamp+"-"+run.Action+".json")
	run.EvidencePath = path
	payload, err := json.MarshalIndent(run, "", "  ")
	if err != nil {
		return fmt.Errorf("encode vulnerability practice evidence: %w", err)
	}
	payload = append(payload, '\n')
	temp, err := os.CreateTemp(root, ".practice-run-*")
	if err != nil {
		return fmt.Errorf("create vulnerability practice evidence: %w", err)
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return fmt.Errorf("protect vulnerability practice evidence: %w", err)
	}
	if _, err := temp.Write(payload); err != nil {
		_ = temp.Close()
		return fmt.Errorf("write vulnerability practice evidence: %w", err)
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return fmt.Errorf("sync vulnerability practice evidence: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close vulnerability practice evidence: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("install vulnerability practice evidence: %w", err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return fmt.Errorf("protect vulnerability practice evidence: %w", err)
	}
	return nil
}

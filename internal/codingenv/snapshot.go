package codingenv

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const maxGitOutputBytes = 2 << 20

var aheadBehindPattern = regexp.MustCompile(`\b(ahead|behind) ([0-9]+)\b`)

type GitStatus struct {
	Available    bool   `json:"available"`
	IsRepository bool   `json:"isRepository"`
	Branch       string `json:"branch,omitempty"`
	Upstream     string `json:"upstream,omitempty"`
	Head         string `json:"head,omitempty"`
	Ahead        int    `json:"ahead"`
	Behind       int    `json:"behind"`
	ChangedFiles int    `json:"changedFiles"`
	Staged       int    `json:"staged"`
	Modified     int    `json:"modified"`
	Untracked    int    `json:"untracked"`
	Conflicts    int    `json:"conflicts"`
	Additions    int    `json:"additions"`
	Deletions    int    `json:"deletions"`
	Dirty        bool   `json:"dirty"`
	Problem      string `json:"problem,omitempty"`
}

type Snapshot struct {
	Workspace     string    `json:"workspace"`
	WorkspaceName string    `json:"workspaceName"`
	CapturedAt    string    `json:"capturedAt"`
	Git           GitStatus `json:"git"`
}

func Inspect(ctx context.Context, workspace string) (Snapshot, error) {
	resolved, err := resolveWorkspace(workspace)
	if err != nil {
		return Snapshot{}, err
	}
	snapshot := Snapshot{
		Workspace:     resolved,
		WorkspaceName: filepath.Base(resolved),
		CapturedAt:    time.Now().UTC().Format(time.RFC3339),
	}
	gitPath, err := exec.LookPath("git")
	if err != nil {
		snapshot.Git.Problem = "Git is not installed or unavailable."
		return snapshot, nil
	}
	snapshot.Git.Available = true

	statusOutput, statusErr := runGit(
		ctx,
		gitPath,
		resolved,
		"status",
		"--porcelain=v1",
		"--branch",
		"--untracked-files=normal",
	)
	if statusErr != nil {
		if isNotRepository(statusOutput) {
			return snapshot, nil
		}
		snapshot.Git.Problem = boundedProblem(statusErr)
		return snapshot, nil
	}
	snapshot.Git = parsePorcelainStatus(statusOutput)
	snapshot.Git.Available = true
	snapshot.Git.IsRepository = true

	if head, headErr := runGit(ctx, gitPath, resolved, "rev-parse", "--short=12", "HEAD"); headErr == nil {
		snapshot.Git.Head = strings.TrimSpace(head)
	}
	if numstat, numstatErr := runGit(ctx, gitPath, resolved, "diff", "--numstat", "HEAD", "--"); numstatErr == nil {
		snapshot.Git.Additions, snapshot.Git.Deletions = parseNumstat(numstat)
	}
	return snapshot, nil
}

func resolveWorkspace(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", fmt.Errorf("Coding workspace is required")
	}
	absolute, err := filepath.Abs(trimmed)
	if err != nil {
		return "", fmt.Errorf("resolve Coding workspace: %w", err)
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", fmt.Errorf("resolve Coding workspace links: %w", err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("open Coding workspace: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("Coding workspace is not a directory")
	}
	return filepath.Clean(resolved), nil
}

func runGit(
	ctx context.Context,
	gitPath,
	workspace string,
	arguments ...string,
) (string, error) {
	commandArguments := append(
		[]string{"--no-optional-locks", "-C", workspace},
		arguments...,
	)
	command := exec.CommandContext(ctx, gitPath, commandArguments...)
	output, err := command.CombinedOutput()
	if len(output) > maxGitOutputBytes {
		return "", fmt.Errorf("Git output exceeded %d bytes", maxGitOutputBytes)
	}
	if err != nil {
		return string(output), err
	}
	return string(output), nil
}

func isNotRepository(output string) bool {
	lower := strings.ToLower(output)
	return strings.Contains(lower, "not a git repository") ||
		strings.Contains(lower, "not a git work tree")
}

func boundedProblem(err error) string {
	if err == nil {
		return ""
	}
	value := strings.TrimSpace(err.Error())
	if len(value) > 240 {
		return value[:240] + "…"
	}
	return value
}

func parsePorcelainStatus(output string) GitStatus {
	status := GitStatus{Available: true, IsRepository: true}
	lines := strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "## ") {
			parseBranchLine(&status, strings.TrimPrefix(line, "## "))
			continue
		}
		if len(line) < 2 {
			continue
		}
		code := line[:2]
		status.ChangedFiles++
		switch code {
		case "??":
			status.Untracked++
			continue
		case "!!":
			status.ChangedFiles--
			continue
		}
		if isConflictCode(code) {
			status.Conflicts++
		}
		if code[0] != ' ' && code[0] != '?' {
			status.Staged++
		}
		if code[1] != ' ' && code[1] != '?' {
			status.Modified++
		}
	}
	status.Dirty = status.ChangedFiles > 0
	return status
}

func parseBranchLine(status *GitStatus, line string) {
	value := strings.TrimSpace(line)
	switch {
	case strings.HasPrefix(value, "No commits yet on "):
		status.Branch = strings.TrimSpace(strings.TrimPrefix(value, "No commits yet on "))
		return
	case strings.HasPrefix(value, "Initial commit on "):
		status.Branch = strings.TrimSpace(strings.TrimPrefix(value, "Initial commit on "))
		return
	case strings.HasPrefix(value, "HEAD (no branch)"):
		status.Branch = "detached"
		return
	}
	branchPart := value
	if bracket := strings.Index(branchPart, " ["); bracket >= 0 {
		branchPart = branchPart[:bracket]
	}
	if separator := strings.Index(branchPart, "..."); separator >= 0 {
		status.Branch = strings.TrimSpace(branchPart[:separator])
		status.Upstream = strings.TrimSpace(branchPart[separator+3:])
	} else {
		status.Branch = strings.TrimSpace(branchPart)
	}
	for _, match := range aheadBehindPattern.FindAllStringSubmatch(value, -1) {
		count, err := strconv.Atoi(match[2])
		if err != nil {
			continue
		}
		if match[1] == "ahead" {
			status.Ahead = count
		} else {
			status.Behind = count
		}
	}
}

func isConflictCode(code string) bool {
	switch code {
	case "DD", "AU", "UD", "UA", "DU", "AA", "UU":
		return true
	default:
		return false
	}
}

func parseNumstat(output string) (int, int) {
	additions := 0
	deletions := 0
	for _, line := range strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		if value, err := strconv.Atoi(fields[0]); err == nil {
			additions += value
		}
		if value, err := strconv.Atoi(fields[1]); err == nil {
			deletions += value
		}
	}
	return additions, deletions
}

func IsTimeout(err error) bool {
	return errors.Is(err, context.DeadlineExceeded)
}

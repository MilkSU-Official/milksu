package codingenv

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	GitActionStage       = "stage"
	GitActionStageAll    = "stage-all"
	GitActionUnstage     = "unstage"
	GitActionUnstageAll  = "unstage-all"
	GitActionDiscardWork = "discard-worktree"
	GitActionCommit      = "commit"
	GitActionPush        = "push"
)

var gitURLUserInfoPattern = regexp.MustCompile(`([A-Za-z][A-Za-z0-9+.-]*://)[^/@\s]+@`)

type GitActionResult struct {
	Action   string   `json:"action"`
	Message  string   `json:"message"`
	Snapshot Snapshot `json:"snapshot"`
}

func ApplyGitAction(
	ctx context.Context,
	workspace,
	action,
	relativePath,
	message string,
) (GitActionResult, error) {
	resolved, err := resolveWorkspace(workspace)
	if err != nil {
		return GitActionResult{}, err
	}
	gitPath, err := exec.LookPath("git")
	if err != nil {
		return GitActionResult{}, errors.New("Git is not installed or unavailable")
	}
	if _, err := runGit(ctx, gitPath, resolved, "rev-parse", "--is-inside-work-tree"); err != nil {
		return GitActionResult{}, errors.New("Coding workspace is not a Git repository")
	}

	normalizedAction := strings.TrimSpace(action)
	switch normalizedAction {
	case GitActionStage:
		pathspec, pathErr := resolveGitPathspec(resolved, relativePath)
		if pathErr != nil {
			return GitActionResult{}, pathErr
		}
		if err := runGitMutation(ctx, gitPath, resolved, "stage change", "add", "--", pathspec); err != nil {
			return GitActionResult{}, err
		}
	case GitActionStageAll:
		if err := runGitMutation(ctx, gitPath, resolved, "stage all changes", "add", "-A", "--", "."); err != nil {
			return GitActionResult{}, err
		}
	case GitActionUnstage:
		pathspec, pathErr := resolveGitPathspec(resolved, relativePath)
		if pathErr != nil {
			return GitActionResult{}, pathErr
		}
		if err := unstage(ctx, gitPath, resolved, pathspec); err != nil {
			return GitActionResult{}, err
		}
	case GitActionUnstageAll:
		if err := unstage(ctx, gitPath, resolved, "."); err != nil {
			return GitActionResult{}, err
		}
	case GitActionDiscardWork:
		pathspec, pathErr := resolveGitPathspec(resolved, relativePath)
		if pathErr != nil {
			return GitActionResult{}, pathErr
		}
		if err := discardWorkingTreeChange(ctx, gitPath, resolved, pathspec); err != nil {
			return GitActionResult{}, err
		}
	case GitActionCommit:
		commitMessage, messageErr := validateCommitMessage(message)
		if messageErr != nil {
			return GitActionResult{}, messageErr
		}
		before, inspectErr := Inspect(ctx, resolved)
		if inspectErr != nil {
			return GitActionResult{}, inspectErr
		}
		if before.Git.Conflicts > 0 {
			return GitActionResult{}, errors.New("resolve Git conflicts before committing")
		}
		if before.Git.Staged == 0 {
			return GitActionResult{}, errors.New("stage at least one change before committing")
		}
		if err := runGitMutation(ctx, gitPath, resolved, "commit changes", "commit", "-m", commitMessage); err != nil {
			return GitActionResult{}, err
		}
	case GitActionPush:
		if err := pushCurrentBranch(ctx, gitPath, resolved); err != nil {
			return GitActionResult{}, err
		}
	default:
		return GitActionResult{}, fmt.Errorf("unsupported Coding Git action: %s", action)
	}

	snapshot, err := Inspect(ctx, resolved)
	if err != nil {
		return GitActionResult{}, err
	}
	return GitActionResult{
		Action:   normalizedAction,
		Message:  gitActionMessage(normalizedAction, snapshot),
		Snapshot: snapshot,
	}, nil
}

func unstage(ctx context.Context, gitPath, workspace, pathspec string) error {
	if _, err := runGit(ctx, gitPath, workspace, "rev-parse", "--verify", "HEAD"); err == nil {
		return runGitMutation(
			ctx,
			gitPath,
			workspace,
			"unstage change",
			"restore",
			"--staged",
			"--",
			pathspec,
		)
	}
	arguments := []string{"rm"}
	if pathspec == "." {
		arguments = append(arguments, "-r")
	}
	arguments = append(arguments, "--cached", "--ignore-unmatch", "--", pathspec)
	return runGitMutation(ctx, gitPath, workspace, "unstage initial change", arguments...)
}

func discardWorkingTreeChange(
	ctx context.Context,
	gitPath,
	workspace,
	pathspec string,
) error {
	snapshot, err := Inspect(ctx, workspace)
	if err != nil {
		return err
	}
	var selected *GitChange
	for index := range snapshot.Git.Changes {
		if snapshot.Git.Changes[index].Path == pathspec {
			selected = &snapshot.Git.Changes[index]
			break
		}
	}
	if selected == nil {
		return errors.New("selected file no longer has a Git change")
	}
	if selected.Conflict {
		return errors.New("resolve conflicts explicitly; MilkSU will not discard a conflicted file")
	}
	if selected.Untracked {
		return errors.New("untracked files are not deleted by this action")
	}
	if selected.Staged {
		return errors.New("unstage this file before discarding its working-tree change")
	}
	if !selected.Modified {
		return errors.New("selected file has no unstaged working-tree change")
	}
	return runGitMutation(
		ctx,
		gitPath,
		workspace,
		"discard working-tree change",
		"restore",
		"--worktree",
		"--",
		pathspec,
	)
}

func pushCurrentBranch(ctx context.Context, gitPath, workspace string) error {
	snapshot, err := Inspect(ctx, workspace)
	if err != nil {
		return err
	}
	if snapshot.Git.Branch == "" || snapshot.Git.Branch == "detached" {
		return errors.New("select a local Git branch before pushing")
	}
	if snapshot.Git.Upstream != "" {
		return runGitMutation(ctx, gitPath, workspace, "push branch", "push", "--porcelain")
	}
	if _, err := runGit(ctx, gitPath, workspace, "remote", "get-url", "origin"); err != nil {
		return errors.New("this branch has no upstream and the repository has no origin remote")
	}
	return runGitMutation(
		ctx,
		gitPath,
		workspace,
		"push branch",
		"push",
		"--porcelain",
		"--set-upstream",
		"origin",
		snapshot.Git.Branch,
	)
}

func validateCommitMessage(value string) (string, error) {
	message := strings.TrimSpace(strings.ReplaceAll(value, "\r\n", "\n"))
	if message == "" {
		return "", errors.New("commit message is required")
	}
	if strings.ContainsRune(message, '\x00') {
		return "", errors.New("commit message contains an invalid null byte")
	}
	if utf8.RuneCountInString(message) > 500 {
		return "", errors.New("commit message must be at most 500 characters")
	}
	return message, nil
}

func runGitMutation(
	ctx context.Context,
	gitPath,
	workspace,
	label string,
	arguments ...string,
) error {
	output, err := runGit(ctx, gitPath, workspace, arguments...)
	if err == nil {
		return nil
	}
	detail := sanitizedGitOutput(output)
	if detail == "" {
		detail = boundedProblem(err)
	}
	return fmt.Errorf("%s failed: %s", label, detail)
}

func sanitizedGitOutput(value string) string {
	output := strings.TrimSpace(strings.ReplaceAll(value, "\x00", ""))
	output = gitURLUserInfoPattern.ReplaceAllString(output, "${1}***@")
	if len(output) > 1200 {
		return output[:1200] + "…"
	}
	return output
}

func gitActionMessage(action string, snapshot Snapshot) string {
	switch action {
	case GitActionStage:
		return "已暂存文件"
	case GitActionStageAll:
		return "已暂存全部变更"
	case GitActionUnstage:
		return "已取消暂存文件"
	case GitActionUnstageAll:
		return "已取消全部暂存"
	case GitActionDiscardWork:
		return "已丢弃未暂存修改"
	case GitActionCommit:
		if snapshot.Git.Head != "" {
			return "已提交 " + snapshot.Git.Head
		}
		return "已创建提交"
	case GitActionPush:
		return "已推送 " + snapshot.Git.Branch
	default:
		return "Git 操作已完成"
	}
}

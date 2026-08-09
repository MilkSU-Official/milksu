package codingcollab

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestManagerCreatesRecoversAndSafelyFinishesIndependentWorktrees(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repository := newRepository(t)
	root := filepath.Join(t.TempDir(), "collaboration")
	manager, err := New(root)
	if err != nil {
		t.Fatal(err)
	}

	status, err := manager.Prepare(ctx, "conversation-one", repository, 2)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Active || status.Phase != phaseActive || len(status.Worktrees) != 2 {
		t.Fatalf("unexpected prepared status: %+v", status)
	}
	if status.Worktrees[0].Path == status.Worktrees[1].Path ||
		status.Worktrees[0].Branch == status.Worktrees[1].Branch {
		t.Fatalf("writer worktrees are not independent: %+v", status.Worktrees)
	}

	firstHead := commitFile(
		t,
		status.Worktrees[0].Path,
		"writer-one.txt",
		"writer one\n",
	)
	secondHead := commitFile(
		t,
		status.Worktrees[1].Path,
		"writer-two.txt",
		"writer two\n",
	)

	restarted, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := restarted.Get(ctx, "conversation-one", repository)
	if err != nil {
		t.Fatal(err)
	}
	if !recovered.Active ||
		recovered.Worktrees[0].Head != firstHead ||
		recovered.Worktrees[1].Head != secondHead ||
		recovered.Worktrees[0].Ahead != 1 ||
		recovered.Worktrees[1].Ahead != 1 {
		t.Fatalf("unexpected recovered state: %+v", recovered)
	}
	if _, err := restarted.Finish(ctx, "conversation-one", repository); err == nil ||
		!strings.Contains(err.Error(), "not integrated") {
		t.Fatalf("expected unintegrated finish rejection, got %v", err)
	}

	git(t, repository, "cherry-pick", firstHead)
	git(t, repository, "cherry-pick", secondHead)
	integrated, err := restarted.Get(ctx, "conversation-one", repository)
	if err != nil {
		t.Fatal(err)
	}
	if !integrated.CanFinish ||
		!integrated.Worktrees[0].Integrated ||
		!integrated.Worktrees[1].Integrated {
		t.Fatalf("expected integrated worktrees: %+v", integrated)
	}
	finished, err := restarted.Finish(ctx, "conversation-one", repository)
	if err != nil {
		t.Fatal(err)
	}
	if finished.Active || finished.Phase != phaseCompleted {
		t.Fatalf("unexpected finished state: %+v", finished)
	}
	for _, worktree := range status.Worktrees {
		if _, err := os.Stat(worktree.Path); !os.IsNotExist(err) {
			t.Fatalf("worktree path still exists: %s", worktree.Path)
		}
		if output := gitAllowFailure(
			t,
			repository,
			"show-ref",
			"--verify",
			"--quiet",
			"refs/heads/"+worktree.Branch,
		); output.success {
			t.Fatalf("worktree branch still exists: %s", worktree.Branch)
		}
	}
}

func TestManagerSharesIgnoredTrackedPackageDependenciesWithoutDirtyingWriter(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repository := newRepository(t)
	for _, path := range []string{
		filepath.Join(repository, "node_modules", "vitepress"),
		filepath.Join(repository, "app", "node_modules", "vite"),
	} {
		if err := os.MkdirAll(path, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	for path, content := range map[string]string{
		".gitignore":       "node_modules/\napp/node_modules/\n",
		"package.json":     "{\"private\":true}\n",
		"app/package.json": "{\"private\":true}\n",
	} {
		absolutePath := filepath.Join(repository, path)
		if err := os.MkdirAll(filepath.Dir(absolutePath), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(absolutePath, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	git(t, repository, "add", ".gitignore", "package.json", "app/package.json")
	git(t, repository, "commit", "-m", "add Node packages")

	manager, err := New(filepath.Join(t.TempDir(), "collaboration"))
	if err != nil {
		t.Fatal(err)
	}
	status, err := manager.Prepare(ctx, "shared-dependencies", repository, 1)
	if err != nil {
		t.Fatal(err)
	}
	writer := status.Worktrees[0]
	for _, dependency := range []string{"node_modules", filepath.Join("app", "node_modules")} {
		view := filepath.Join(writer.Path, dependency)
		info, err := os.Lstat(view)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			t.Fatalf("shared dependency is not a managed directory: %s info=%v err=%v", view, info, err)
		}
		entries, err := os.ReadDir(filepath.Join(repository, dependency))
		if err != nil || len(entries) != 1 {
			t.Fatalf("read dependency fixture: entries=%v err=%v", entries, err)
		}
		resolved, err := filepath.EvalSymlinks(filepath.Join(view, entries[0].Name()))
		if err != nil || resolved != filepath.Join(repository, dependency, entries[0].Name()) {
			t.Fatalf("unexpected shared dependency target: %s err=%v", resolved, err)
		}
	}
	refreshed, err := manager.Get(ctx, "shared-dependencies", repository)
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.Worktrees[0].Dirty || !refreshed.CanFinish {
		t.Fatalf("shared dependencies dirtied the writer: %+v", refreshed.Worktrees[0])
	}
	current, found, err := manager.load("shared-dependencies")
	if err != nil || !found {
		t.Fatalf("load collaboration manifest: found=%v err=%v", found, err)
	}
	if strings.Join(current.SharedDependencies, ",") != "app/node_modules,node_modules" {
		t.Fatalf("unexpected shared dependencies: %v", current.SharedDependencies)
	}
}

func TestManagerSafelyFinishesWorktreeContainingSubmodule(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repository := newRepository(t)
	submodule := newRepository(t)
	git(
		t,
		repository,
		"-c",
		"protocol.file.allow=always",
		"submodule",
		"add",
		submodule,
		"packages/ui",
	)
	git(t, repository, "commit", "-m", "add local UI submodule")

	manager, err := New(filepath.Join(t.TempDir(), "collaboration"))
	if err != nil {
		t.Fatal(err)
	}
	status, err := manager.Prepare(ctx, "submodule-writer", repository, 1)
	if err != nil {
		t.Fatal(err)
	}
	writer := status.Worktrees[0]
	git(
		t,
		writer.Path,
		"-c",
		"protocol.file.allow=always",
		"submodule",
		"update",
		"--init",
	)
	writerHead := commitFile(
		t,
		writer.Path,
		"writer-change.txt",
		"integrated writer change\n",
	)
	git(t, repository, "cherry-pick", writerHead)

	integrated, err := manager.Get(ctx, "submodule-writer", repository)
	if err != nil {
		t.Fatal(err)
	}
	if !integrated.CanFinish || !integrated.Worktrees[0].Integrated {
		t.Fatalf("expected integrated submodule worktree: %+v", integrated)
	}
	finished, err := manager.Finish(ctx, "submodule-writer", repository)
	if err != nil {
		t.Fatal(err)
	}
	if finished.Active || finished.Phase != phaseCompleted {
		t.Fatalf("unexpected finished state: %+v", finished)
	}
	if _, err := os.Stat(writer.Path); !os.IsNotExist(err) {
		t.Fatalf("submodule worktree path still exists: %s", writer.Path)
	}
	if gitAllowFailure(
		t,
		repository,
		"show-ref",
		"--verify",
		"--quiet",
		"refs/heads/"+writer.Branch,
	).success {
		t.Fatalf("submodule worktree branch still exists: %s", writer.Branch)
	}
}

func TestManagerRejectsDirtyInitializedSubmoduleBeforeForcedRemoval(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repository := newRepository(t)
	submodule := newRepository(t)
	git(
		t,
		repository,
		"-c",
		"protocol.file.allow=always",
		"submodule",
		"add",
		submodule,
		"packages/ui",
	)
	git(t, repository, "commit", "-m", "add local UI submodule")

	manager, err := New(filepath.Join(t.TempDir(), "collaboration"))
	if err != nil {
		t.Fatal(err)
	}
	status, err := manager.Prepare(ctx, "dirty-submodule-writer", repository, 1)
	if err != nil {
		t.Fatal(err)
	}
	writer := status.Worktrees[0]
	git(
		t,
		writer.Path,
		"-c",
		"protocol.file.allow=always",
		"submodule",
		"update",
		"--init",
	)
	git(t, writer.Path, "config", "submodule.packages/ui.ignore", "all")
	dirtyPath := filepath.Join(writer.Path, "packages", "ui", "local.txt")
	if err := os.WriteFile(dirtyPath, []byte("must survive\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if ordinaryStatus := git(
		t,
		writer.Path,
		"status",
		"--porcelain=v1",
	); ordinaryStatus != "" {
		t.Fatalf(
			"fixture did not hide the dirty submodule from ordinary status: %q",
			ordinaryStatus,
		)
	}

	refreshed, err := manager.Get(ctx, "dirty-submodule-writer", repository)
	if err != nil {
		t.Fatal(err)
	}
	if !refreshed.Worktrees[0].Dirty || refreshed.CanFinish {
		t.Fatalf("dirty submodule was not detected: %+v", refreshed)
	}
	if _, err := manager.Finish(
		ctx,
		"dirty-submodule-writer",
		repository,
	); err == nil || !strings.Contains(err.Error(), "uncommitted changes") {
		t.Fatalf("expected dirty submodule rejection, got %v", err)
	}
	if content, err := os.ReadFile(dirtyPath); err != nil ||
		string(content) != "must survive\n" {
		t.Fatalf("dirty submodule content was not preserved: %q err=%v", content, err)
	}
}

func TestManagerRejectsDirtyBaseAndDirtyWriter(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repository := newRepository(t)
	manager, err := New(filepath.Join(t.TempDir(), "collaboration"))
	if err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(repository, "dirty.txt"), []byte("dirty\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Prepare(ctx, "dirty-base", repository, 1); err == nil ||
		!strings.Contains(err.Error(), "main worktree changes") {
		t.Fatalf("expected dirty base rejection, got %v", err)
	}
	if err := os.Remove(filepath.Join(repository, "dirty.txt")); err != nil {
		t.Fatal(err)
	}

	status, err := manager.Prepare(ctx, "dirty-writer", repository, 1)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(status.Worktrees[0].Path, "dirty.txt"),
		[]byte("dirty\n"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Finish(ctx, "dirty-writer", repository); err == nil ||
		!strings.Contains(err.Error(), "uncommitted changes") {
		t.Fatalf("expected dirty writer rejection, got %v", err)
	}
}

func TestManagerDescriptorIsConversationAndRepositoryBound(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repository := newRepository(t)
	otherRepository := newRepository(t)
	manager, err := New(filepath.Join(t.TempDir(), "collaboration"))
	if err != nil {
		t.Fatal(err)
	}
	status, err := manager.Prepare(ctx, "bound-task", repository, 1)
	if err != nil {
		t.Fatal(err)
	}

	descriptor, err := manager.Descriptor(ctx, "bound-task", repository)
	if err != nil {
		t.Fatal(err)
	}
	if descriptor == nil ||
		descriptor.Workspace != repository ||
		len(descriptor.Worktrees) != 1 ||
		descriptor.Worktrees[0].Path != status.Worktrees[0].Path {
		t.Fatalf("unexpected descriptor: %+v", descriptor)
	}
	if _, err := manager.Descriptor(ctx, "bound-task", otherRepository); err == nil {
		t.Fatal("expected repository-bound descriptor rejection")
	}
	other, err := manager.Descriptor(ctx, "another-task", repository)
	if err != nil {
		t.Fatal(err)
	}
	if other != nil {
		t.Fatalf("unexpected descriptor for another conversation: %+v", other)
	}
}

func TestManagerSafelyCleansInterruptedPreparationWithoutDeletingForeignBranch(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repository := newRepository(t)
	root := filepath.Join(t.TempDir(), "collaboration")
	manager, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	conversationID := "interrupted-preparation"
	key := taskKey(conversationID)
	firstBranch := "codex/agent-" + key[:12] + "-writer-1"
	foreignBranch := "codex/agent-" + key[:12] + "-writer-2"
	git(t, repository, "branch", foreignBranch)

	if _, err := manager.Prepare(
		ctx,
		conversationID,
		repository,
		2,
	); err == nil || !strings.Contains(err.Error(), "reserved collaboration branch") {
		t.Fatalf("expected the second writer collision to interrupt preparation, got %v", err)
	}
	interrupted, err := manager.Get(ctx, conversationID, repository)
	if err != nil {
		t.Fatal(err)
	}
	if interrupted.Phase != phasePreparing ||
		interrupted.Problem != "Coding collaboration preparation was interrupted" ||
		!interrupted.CanFinish ||
		!interrupted.Worktrees[0].Available ||
		interrupted.Worktrees[1].Available {
		t.Fatalf("unexpected interrupted state: %+v", interrupted)
	}

	restarted, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	finished, err := restarted.Finish(ctx, conversationID, repository)
	if err != nil {
		t.Fatal(err)
	}
	if finished.Phase != phaseCompleted {
		t.Fatalf("unexpected cleaned state: %+v", finished)
	}
	if gitAllowFailure(
		t,
		repository,
		"show-ref",
		"--verify",
		"--quiet",
		"refs/heads/"+firstBranch,
	).success {
		t.Fatal("MilkSU-owned partial writer branch was not removed")
	}
	if !gitAllowFailure(
		t,
		repository,
		"show-ref",
		"--verify",
		"--quiet",
		"refs/heads/"+foreignBranch,
	).success {
		t.Fatal("foreign colliding branch was deleted")
	}
}

func TestManagerCleansPersistedWriterWhenPreparationStopsAfterGitAdd(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repository := newRepository(t)
	root := filepath.Join(t.TempDir(), "collaboration")
	manager, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	conversationID := "interrupted-after-git-add"
	status, err := manager.Prepare(ctx, conversationID, repository, 1)
	if err != nil {
		t.Fatal(err)
	}
	current, found, err := manager.load(conversationID)
	if err != nil || !found {
		t.Fatalf("load manifest: found=%v err=%v", found, err)
	}
	current.Phase = phasePreparing
	if err := manager.save(current); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(status.Worktrees[0].Path); err != nil {
		t.Fatal(err)
	}

	restarted, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	interrupted, err := restarted.Get(ctx, conversationID, repository)
	if err != nil {
		t.Fatal(err)
	}
	if !interrupted.CanFinish || interrupted.Worktrees[0].Available {
		t.Fatalf("expected a safely cleanable missing writer: %+v", interrupted)
	}
	if _, err := restarted.Finish(ctx, conversationID, repository); err != nil {
		t.Fatal(err)
	}
	if gitAllowFailure(
		t,
		repository,
		"show-ref",
		"--verify",
		"--quiet",
		"refs/heads/"+status.Worktrees[0].Branch,
	).success {
		t.Fatal("persisted interrupted writer branch was not removed")
	}
}

func newRepository(t *testing.T) string {
	t.Helper()
	repository := filepath.Join(t.TempDir(), "repository")
	if err := os.MkdirAll(repository, 0o700); err != nil {
		t.Fatal(err)
	}
	git(t, repository, "init", "-b", "main")
	git(t, repository, "config", "user.name", "MilkSU Test")
	git(t, repository, "config", "user.email", "test@milksu.invalid")
	if err := os.WriteFile(filepath.Join(repository, "README.md"), []byte("# fixture\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	git(t, repository, "add", "README.md")
	git(t, repository, "commit", "-m", "initial")
	resolved, err := filepath.EvalSymlinks(repository)
	if err != nil {
		t.Fatal(err)
	}
	return resolved
}

func commitFile(t *testing.T, repository, name, content string) string {
	t.Helper()
	if err := os.WriteFile(filepath.Join(repository, name), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	git(t, repository, "add", name)
	git(t, repository, "commit", "-m", "add "+name)
	return git(t, repository, "rev-parse", "HEAD")
}

func git(t *testing.T, repository string, arguments ...string) string {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", repository}, arguments...)...)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", arguments, err, output)
	}
	return strings.TrimSpace(string(output))
}

type gitResult struct {
	success bool
	output  string
}

func gitAllowFailure(t *testing.T, repository string, arguments ...string) gitResult {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", repository}, arguments...)...)
	output, err := command.CombinedOutput()
	return gitResult{success: err == nil, output: strings.TrimSpace(string(output))}
}

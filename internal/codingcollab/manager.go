package codingcollab

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	SchemaVersion = 1
	MinWriters    = 1
	MaxWriters    = 2

	phasePreparing = "preparing"
	phaseActive    = "active"
	phaseCompleted = "completed"
)

type Worktree struct {
	ID          string `json:"id"`
	Path        string `json:"path"`
	Branch      string `json:"branch"`
	BaseHead    string `json:"baseHead"`
	Head        string `json:"head,omitempty"`
	Dirty       bool   `json:"dirty"`
	Ahead       int    `json:"ahead"`
	Behind      int    `json:"behind"`
	Integrated  bool   `json:"integrated"`
	Available   bool   `json:"available"`
	Provisioned bool   `json:"provisioned,omitempty"`
	Problem     string `json:"problem,omitempty"`
}

type Status struct {
	SchemaVersion  int        `json:"schemaVersion"`
	ConversationID string     `json:"conversationId"`
	Workspace      string     `json:"workspace"`
	BaseBranch     string     `json:"baseBranch,omitempty"`
	BaseHead       string     `json:"baseHead,omitempty"`
	Phase          string     `json:"phase"`
	Active         bool       `json:"active"`
	CanFinish      bool       `json:"canFinish"`
	CreatedAt      string     `json:"createdAt,omitempty"`
	UpdatedAt      string     `json:"updatedAt,omitempty"`
	CompletedAt    string     `json:"completedAt,omitempty"`
	Worktrees      []Worktree `json:"worktrees"`
	Problem        string     `json:"problem,omitempty"`
}

type Descriptor struct {
	SchemaVersion  int                  `json:"schemaVersion"`
	ConversationID string               `json:"conversationId"`
	Workspace      string               `json:"workspace"`
	BaseHead       string               `json:"baseHead"`
	Worktrees      []WorktreeDescriptor `json:"worktrees"`
}

type WorktreeDescriptor struct {
	ID     string `json:"id"`
	Path   string `json:"path"`
	Branch string `json:"branch"`
}

type manifest struct {
	SchemaVersion  int        `json:"schemaVersion"`
	ConversationID string     `json:"conversationId"`
	Workspace      string     `json:"workspace"`
	BaseBranch     string     `json:"baseBranch"`
	BaseHead       string     `json:"baseHead"`
	Phase          string     `json:"phase"`
	CreatedAt      string     `json:"createdAt"`
	UpdatedAt      string     `json:"updatedAt"`
	CompletedAt    string     `json:"completedAt,omitempty"`
	Worktrees      []Worktree `json:"worktrees"`
}

type Manager struct {
	mu      sync.Mutex
	root    string
	gitPath string
	now     func() time.Time
}

func New(root string) (*Manager, error) {
	resolvedRoot, err := filepath.Abs(strings.TrimSpace(root))
	if err != nil {
		return nil, fmt.Errorf("resolve Coding collaboration directory: %w", err)
	}
	if strings.TrimSpace(root) == "" {
		return nil, errors.New("Coding collaboration directory is required")
	}
	if err := os.MkdirAll(resolvedRoot, 0o700); err != nil {
		return nil, fmt.Errorf("create Coding collaboration directory: %w", err)
	}
	if err := os.Chmod(resolvedRoot, 0o700); err != nil {
		return nil, fmt.Errorf("protect Coding collaboration directory: %w", err)
	}
	resolvedRoot, err = filepath.EvalSymlinks(resolvedRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve Coding collaboration directory links: %w", err)
	}
	gitPath, err := exec.LookPath("git")
	if err != nil {
		return nil, errors.New("Git is not installed or unavailable")
	}
	return &Manager{
		root:    resolvedRoot,
		gitPath: gitPath,
		now:     time.Now,
	}, nil
}

func (m *Manager) Prepare(
	ctx context.Context,
	conversationID,
	workspace string,
	writers int,
) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	conversationID, err := normalizeConversationID(conversationID)
	if err != nil {
		return Status{}, err
	}
	if writers < MinWriters || writers > MaxWriters {
		return Status{}, fmt.Errorf(
			"Coding collaboration requires %d or %d writer worktrees",
			MinWriters,
			MaxWriters,
		)
	}
	repository, baseBranch, baseHead, err := m.inspectCleanRepository(ctx, workspace)
	if err != nil {
		return Status{}, err
	}

	current, found, err := m.load(conversationID)
	if err != nil {
		return Status{}, err
	}
	if found && current.Phase != phaseCompleted {
		if current.Workspace != repository {
			return Status{}, errors.New(
				"this Coding task already owns collaboration worktrees for another repository",
			)
		}
		if len(current.Worktrees) != writers {
			return Status{}, errors.New(
				"finish the current Coding collaboration before changing writer count",
			)
		}
		return m.refreshLocked(ctx, current)
	}

	taskDirectory := m.taskDirectory(conversationID)
	if err := os.MkdirAll(taskDirectory, 0o700); err != nil {
		return Status{}, fmt.Errorf("create Coding collaboration task directory: %w", err)
	}
	key := taskKey(conversationID)
	worktrees := make([]Worktree, 0, writers)
	for index := 1; index <= writers; index++ {
		worktrees = append(worktrees, Worktree{
			ID:       "writer-" + strconv.Itoa(index),
			Path:     filepath.Join(taskDirectory, "writer-"+strconv.Itoa(index)),
			Branch:   fmt.Sprintf("codex/agent-%s-writer-%d", key[:12], index),
			BaseHead: baseHead,
		})
	}
	now := m.now().UTC().Format(time.RFC3339Nano)
	next := manifest{
		SchemaVersion:  SchemaVersion,
		ConversationID: conversationID,
		Workspace:      repository,
		BaseBranch:     baseBranch,
		BaseHead:       baseHead,
		Phase:          phasePreparing,
		CreatedAt:      now,
		UpdatedAt:      now,
		Worktrees:      worktrees,
	}
	if err := m.save(next); err != nil {
		return Status{}, err
	}

	for index, worktree := range worktrees {
		if _, statErr := os.Lstat(worktree.Path); !errors.Is(statErr, os.ErrNotExist) {
			return Status{}, fmt.Errorf(
				"reserved collaboration path already exists: %s",
				worktree.Path,
			)
		}
		if m.localBranchExists(ctx, repository, worktree.Branch) {
			return Status{}, fmt.Errorf(
				"reserved collaboration branch already exists: %s",
				worktree.Branch,
			)
		}
		if _, err := m.git(
			ctx,
			repository,
			"worktree",
			"add",
			"-b",
			worktree.Branch,
			worktree.Path,
			baseHead,
		); err != nil {
			return Status{}, fmt.Errorf(
				"create %s collaboration worktree: %w",
				worktree.ID,
				err,
			)
		}
		next.Worktrees[index].Provisioned = true
		next.UpdatedAt = m.now().UTC().Format(time.RFC3339Nano)
		if err := m.save(next); err != nil {
			return Status{}, err
		}
	}
	next.Phase = phaseActive
	next.UpdatedAt = m.now().UTC().Format(time.RFC3339Nano)
	if err := m.save(next); err != nil {
		return Status{}, err
	}
	return m.refreshLocked(ctx, next)
}

func (m *Manager) Get(
	ctx context.Context,
	conversationID,
	workspace string,
) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	conversationID, err := normalizeConversationID(conversationID)
	if err != nil {
		return Status{}, err
	}
	current, found, err := m.load(conversationID)
	if err != nil {
		return Status{}, err
	}
	if !found {
		resolvedWorkspace, _ := resolveDirectory(workspace)
		return Status{
			SchemaVersion:  SchemaVersion,
			ConversationID: conversationID,
			Workspace:      resolvedWorkspace,
			Phase:          phaseCompleted,
			Worktrees:      []Worktree{},
		}, nil
	}
	if strings.TrimSpace(workspace) != "" {
		resolvedWorkspace, resolveErr := resolveDirectory(workspace)
		if resolveErr != nil {
			return Status{}, resolveErr
		}
		if resolvedWorkspace != current.Workspace {
			return Status{}, errors.New(
				"the Coding collaboration belongs to a different repository",
			)
		}
	}
	if current.Phase == phaseCompleted {
		return statusFromManifest(current), nil
	}
	return m.refreshLocked(ctx, current)
}

func (m *Manager) Descriptor(
	ctx context.Context,
	conversationID,
	workspace string,
) (*Descriptor, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	conversationID, err := normalizeConversationID(conversationID)
	if err != nil {
		return nil, err
	}
	current, found, err := m.load(conversationID)
	if err != nil || !found {
		return nil, err
	}
	if current.Phase != phaseActive {
		return nil, nil
	}
	resolvedWorkspace, err := resolveDirectory(workspace)
	if err != nil {
		return nil, err
	}
	if resolvedWorkspace != current.Workspace {
		return nil, errors.New(
			"the active Coding collaboration belongs to a different repository",
		)
	}
	status, err := m.refreshLocked(ctx, current)
	if err != nil {
		return nil, err
	}
	if !status.Active || status.Problem != "" {
		return nil, errors.New("Coding collaboration worktrees are not ready")
	}
	descriptor := &Descriptor{
		SchemaVersion:  SchemaVersion,
		ConversationID: conversationID,
		Workspace:      current.Workspace,
		BaseHead:       current.BaseHead,
		Worktrees:      make([]WorktreeDescriptor, 0, len(status.Worktrees)),
	}
	for _, worktree := range status.Worktrees {
		if !worktree.Available || worktree.Problem != "" {
			return nil, fmt.Errorf("%s collaboration worktree is unavailable", worktree.ID)
		}
		descriptor.Worktrees = append(descriptor.Worktrees, WorktreeDescriptor{
			ID:     worktree.ID,
			Path:   worktree.Path,
			Branch: worktree.Branch,
		})
	}
	return descriptor, nil
}

func (m *Manager) Finish(
	ctx context.Context,
	conversationID,
	workspace string,
) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	conversationID, err := normalizeConversationID(conversationID)
	if err != nil {
		return Status{}, err
	}
	current, found, err := m.load(conversationID)
	if err != nil {
		return Status{}, err
	}
	if !found || current.Phase == phaseCompleted {
		return Status{}, errors.New("there is no active Coding collaboration to finish")
	}
	resolvedWorkspace, err := resolveDirectory(workspace)
	if err != nil {
		return Status{}, err
	}
	if resolvedWorkspace != current.Workspace {
		return Status{}, errors.New(
			"the Coding collaboration belongs to a different repository",
		)
	}
	status, err := m.refreshLocked(ctx, current)
	if err != nil {
		return Status{}, err
	}
	for index, worktree := range status.Worktrees {
		expected := current.Worktrees[index]
		if worktree.Problem != "" &&
			!(current.Phase == phasePreparing &&
				expected.Provisioned &&
				missingPath(worktree.Path)) &&
			!(current.Phase == phasePreparing && !expected.Provisioned) {
			return Status{}, fmt.Errorf(
				"cannot finish %s: %s",
				worktree.ID,
				worktree.Problem,
			)
		}
		if worktree.Dirty {
			return Status{}, fmt.Errorf(
				"cannot finish %s: its worktree has uncommitted changes",
				worktree.ID,
			)
		}
		if current.Phase == phaseActive && !worktree.Integrated {
			return Status{}, fmt.Errorf(
				"cannot finish %s: commit %s is not integrated into the main worktree",
				worktree.ID,
				shortHead(worktree.Head),
			)
		}
		if current.Phase == phasePreparing && worktree.Ahead > 0 {
			return Status{}, fmt.Errorf(
				"cannot clean interrupted %s: it contains unintegrated commits",
				worktree.ID,
			)
		}
		if current.Phase == phasePreparing &&
			worktree.Problem != "" &&
			expected.Provisioned {
			head, headErr := m.localBranchHead(
				ctx,
				current.Workspace,
				worktree.Branch,
			)
			if headErr != nil && m.localBranchExists(
				ctx,
				current.Workspace,
				worktree.Branch,
			) {
				return Status{}, fmt.Errorf(
					"cannot inspect interrupted %s branch: %w",
					worktree.ID,
					headErr,
				)
			}
			if head != "" && head != current.BaseHead {
				return Status{}, fmt.Errorf(
					"cannot clean interrupted %s: its branch contains unintegrated commits",
					worktree.ID,
				)
			}
		}
	}
	for index, worktree := range status.Worktrees {
		expected := current.Worktrees[index]
		if worktree.Available {
			if _, err := m.git(
				ctx,
				current.Workspace,
				"worktree",
				"remove",
				worktree.Path,
			); err != nil {
				return Status{}, fmt.Errorf("remove %s worktree: %w", worktree.ID, err)
			}
		} else if current.Phase == phasePreparing &&
			expected.Provisioned &&
			missingPath(worktree.Path) {
			// The app can terminate after `git worktree add` but before the
			// preparation reaches active. Remove only the exact persisted
			// reservation; never force-clean an existing or unowned path.
			if _, err := m.git(
				ctx,
				current.Workspace,
				"worktree",
				"remove",
				"--force",
				worktree.Path,
			); err != nil && m.localBranchExists(
				ctx,
				current.Workspace,
				worktree.Branch,
			) {
				return Status{}, fmt.Errorf(
					"remove interrupted %s worktree metadata: %w",
					worktree.ID,
					err,
				)
			}
		}
		ownsBranch := current.Phase == phaseActive ||
			expected.Provisioned ||
			worktree.Available
		if ownsBranch &&
			m.localBranchExists(ctx, current.Workspace, worktree.Branch) {
			expectedHead := worktree.Head
			if expectedHead == "" {
				expectedHead = current.BaseHead
			}
			if _, err := m.git(
				ctx,
				current.Workspace,
				"update-ref",
				"-d",
				"refs/heads/"+worktree.Branch,
				expectedHead,
			); err != nil {
				return Status{}, fmt.Errorf("delete %s branch: %w", worktree.ID, err)
			}
		}
	}
	now := m.now().UTC().Format(time.RFC3339Nano)
	current.Phase = phaseCompleted
	current.UpdatedAt = now
	current.CompletedAt = now
	if err := m.save(current); err != nil {
		return Status{}, err
	}
	return statusFromManifest(current), nil
}

func (m *Manager) refreshLocked(ctx context.Context, current manifest) (Status, error) {
	mainHead, err := m.git(ctx, current.Workspace, "rev-parse", "HEAD")
	if err != nil {
		status := statusFromManifest(current)
		status.Problem = "main repository is unavailable"
		return status, nil
	}
	allAvailable := true
	allFinishable := true
	refreshed := make([]Worktree, 0, len(current.Worktrees))
	for _, expected := range current.Worktrees {
		worktree := expected
		worktree.Available = false
		worktree.Problem = ""
		root, rootErr := m.git(ctx, worktree.Path, "rev-parse", "--show-toplevel")
		if rootErr != nil || canonicalExistingPath(root) != worktree.Path {
			worktree.Problem = "worktree is missing or no longer resolves to its reserved path"
			allAvailable = false
			safeInterruptedSlot := current.Phase == phasePreparing &&
				missingPath(worktree.Path)
			if safeInterruptedSlot && worktree.Provisioned {
				head, headErr := m.localBranchHead(
					ctx,
					current.Workspace,
					worktree.Branch,
				)
				branchExists := m.localBranchExists(
					ctx,
					current.Workspace,
					worktree.Branch,
				)
				safeInterruptedSlot = !branchExists ||
					(headErr == nil && head == current.BaseHead)
			}
			if !safeInterruptedSlot {
				allFinishable = false
			}
			refreshed = append(refreshed, worktree)
			continue
		}
		branch, branchErr := m.git(ctx, worktree.Path, "branch", "--show-current")
		if branchErr != nil || branch != worktree.Branch {
			worktree.Problem = "worktree branch no longer matches its reserved branch"
			allAvailable = false
			allFinishable = false
			refreshed = append(refreshed, worktree)
			continue
		}
		head, headErr := m.git(ctx, worktree.Path, "rev-parse", "HEAD")
		statusText, statusErr := m.git(
			ctx,
			worktree.Path,
			"status",
			"--porcelain=v1",
			"--untracked-files=normal",
		)
		ahead, aheadErr := m.gitCount(
			ctx,
			worktree.Path,
			current.BaseHead+".."+head,
		)
		behind, behindErr := m.gitCount(
			ctx,
			worktree.Path,
			head+".."+current.BaseHead,
		)
		if headErr != nil || statusErr != nil || aheadErr != nil || behindErr != nil {
			worktree.Problem = "worktree Git state could not be inspected"
			allAvailable = false
			allFinishable = false
			refreshed = append(refreshed, worktree)
			continue
		}
		worktree.Head = head
		worktree.Dirty = statusText != ""
		worktree.Ahead = ahead
		worktree.Behind = behind
		worktree.Integrated = m.branchIntegrated(
			ctx,
			current.Workspace,
			current.BaseHead,
			head,
			mainHead,
		)
		worktree.Available = true
		if worktree.Dirty ||
			(current.Phase == phaseActive && !worktree.Integrated) ||
			(current.Phase == phasePreparing && worktree.Ahead > 0) {
			allFinishable = false
		}
		refreshed = append(refreshed, worktree)
	}

	if current.Phase == phasePreparing && allAvailable {
		current.Phase = phaseActive
		current.UpdatedAt = m.now().UTC().Format(time.RFC3339Nano)
		current.Worktrees = refreshed
		if err := m.save(current); err != nil {
			return Status{}, err
		}
	}
	status := statusFromManifest(current)
	status.Worktrees = refreshed
	status.Active = current.Phase == phaseActive && allAvailable
	status.CanFinish = allFinishable && len(refreshed) > 0
	if current.Phase == phasePreparing && !allAvailable {
		status.Problem = "Coding collaboration preparation was interrupted"
	}
	return status, nil
}

func (m *Manager) inspectCleanRepository(
	ctx context.Context,
	workspace string,
) (string, string, string, error) {
	resolved, err := resolveDirectory(workspace)
	if err != nil {
		return "", "", "", err
	}
	root, err := m.git(ctx, resolved, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", "", "", errors.New("Coding workspace is not a Git repository")
	}
	root = canonicalExistingPath(root)
	if root != resolved {
		return "", "", "", errors.New(
			"select the Git repository root before preparing Coding collaboration",
		)
	}
	branch, err := m.git(ctx, root, "branch", "--show-current")
	if err != nil || branch == "" {
		return "", "", "", errors.New(
			"Coding collaboration requires a named base branch",
		)
	}
	head, err := m.git(ctx, root, "rev-parse", "HEAD")
	if err != nil || !validObjectID(head) {
		return "", "", "", errors.New(
			"Coding collaboration requires a committed base",
		)
	}
	status, err := m.git(
		ctx,
		root,
		"status",
		"--porcelain=v1",
		"--untracked-files=normal",
	)
	if err != nil {
		return "", "", "", fmt.Errorf("inspect Coding repository status: %w", err)
	}
	if status != "" {
		return "", "", "", errors.New(
			"commit, stash, or discard main worktree changes before preparing Coding collaboration",
		)
	}
	return root, branch, head, nil
}

func (m *Manager) load(conversationID string) (manifest, bool, error) {
	data, err := os.ReadFile(m.manifestPath(conversationID))
	if errors.Is(err, os.ErrNotExist) {
		return manifest{}, false, nil
	}
	if err != nil {
		return manifest{}, false, fmt.Errorf("read Coding collaboration manifest: %w", err)
	}
	var value manifest
	if err := json.Unmarshal(data, &value); err != nil {
		return manifest{}, false, fmt.Errorf("decode Coding collaboration manifest: %w", err)
	}
	if err := m.validateManifest(value, conversationID); err != nil {
		return manifest{}, false, err
	}
	return value, true, nil
}

func (m *Manager) save(value manifest) error {
	value.SchemaVersion = SchemaVersion
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("encode Coding collaboration manifest: %w", err)
	}
	directory := m.taskDirectory(value.ConversationID)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create Coding collaboration manifest directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".manifest-*.json")
	if err != nil {
		return fmt.Errorf("create Coding collaboration manifest: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect Coding collaboration manifest: %w", err)
	}
	if _, err := temporary.Write(append(data, '\n')); err != nil {
		temporary.Close()
		return fmt.Errorf("write Coding collaboration manifest: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync Coding collaboration manifest: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close Coding collaboration manifest: %w", err)
	}
	if err := os.Rename(temporaryPath, m.manifestPath(value.ConversationID)); err != nil {
		return fmt.Errorf("replace Coding collaboration manifest: %w", err)
	}
	return nil
}

func (m *Manager) validateManifest(value manifest, conversationID string) error {
	if value.SchemaVersion != SchemaVersion {
		return fmt.Errorf(
			"unsupported Coding collaboration schema version %d",
			value.SchemaVersion,
		)
	}
	if value.ConversationID != conversationID {
		return errors.New("Coding collaboration manifest conversation mismatch")
	}
	if value.Phase != phasePreparing &&
		value.Phase != phaseActive &&
		value.Phase != phaseCompleted {
		return errors.New("Coding collaboration manifest has an invalid phase")
	}
	if !validObjectID(value.BaseHead) ||
		value.Workspace == "" ||
		canonicalExistingPath(value.Workspace) != value.Workspace {
		return errors.New("Coding collaboration manifest has an invalid repository")
	}
	if len(value.Worktrees) < MinWriters || len(value.Worktrees) > MaxWriters {
		return errors.New("Coding collaboration manifest has an invalid writer count")
	}
	key := taskKey(conversationID)
	for index, worktree := range value.Worktrees {
		expectedID := "writer-" + strconv.Itoa(index+1)
		expectedPath := filepath.Join(m.taskDirectory(conversationID), expectedID)
		expectedBranch := fmt.Sprintf(
			"codex/agent-%s-writer-%d",
			key[:12],
			index+1,
		)
		if worktree.ID != expectedID ||
			worktree.Path != expectedPath ||
			worktree.Branch != expectedBranch ||
			worktree.BaseHead != value.BaseHead {
			return errors.New("Coding collaboration manifest worktree boundary mismatch")
		}
	}
	return nil
}

func (m *Manager) git(
	ctx context.Context,
	directory string,
	arguments ...string,
) (string, error) {
	command := exec.CommandContext(ctx, m.gitPath, append(
		[]string{"-C", directory},
		arguments...,
	)...)
	output, err := command.CombinedOutput()
	value := strings.TrimSpace(string(output))
	if err != nil {
		if value == "" {
			value = err.Error()
		}
		return "", errors.New(value)
	}
	return value, nil
}

func (m *Manager) gitCount(
	ctx context.Context,
	directory,
	revision string,
) (int, error) {
	value, err := m.git(ctx, directory, "rev-list", "--count", revision)
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(value)
}

func (m *Manager) localBranchExists(
	ctx context.Context,
	repository,
	branch string,
) bool {
	command := exec.CommandContext(
		ctx,
		m.gitPath,
		"-C",
		repository,
		"show-ref",
		"--verify",
		"--quiet",
		"refs/heads/"+branch,
	)
	return command.Run() == nil
}

func (m *Manager) localBranchHead(
	ctx context.Context,
	repository,
	branch string,
) (string, error) {
	return m.git(ctx, repository, "rev-parse", "--verify", "refs/heads/"+branch)
}

func missingPath(path string) bool {
	_, err := os.Lstat(path)
	return errors.Is(err, os.ErrNotExist)
}

func (m *Manager) isAncestor(
	ctx context.Context,
	repository,
	ancestor,
	descendant string,
) bool {
	command := exec.CommandContext(
		ctx,
		m.gitPath,
		"-C",
		repository,
		"merge-base",
		"--is-ancestor",
		ancestor,
		descendant,
	)
	return command.Run() == nil
}

func (m *Manager) branchIntegrated(
	ctx context.Context,
	repository,
	baseHead,
	branchHead,
	mainHead string,
) bool {
	if m.isAncestor(ctx, repository, branchHead, mainHead) {
		return true
	}
	// Main-Agent integration commonly uses cherry-pick, which deliberately
	// changes commit IDs. `git cherry` compares patch IDs and marks a commit
	// with "-" only when an equivalent patch already exists upstream. Require
	// every commit after the immutable base to have that evidence.
	output, err := m.git(
		ctx,
		repository,
		"cherry",
		mainHead,
		branchHead,
		baseHead,
	)
	if err != nil || output == "" {
		return false
	}
	for _, line := range strings.Split(output, "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "- ") {
			return false
		}
	}
	return true
}

func (m *Manager) taskDirectory(conversationID string) string {
	return filepath.Join(m.root, taskKey(conversationID))
}

func (m *Manager) manifestPath(conversationID string) string {
	return filepath.Join(m.taskDirectory(conversationID), "manifest.json")
}

func taskKey(conversationID string) string {
	digest := sha256.Sum256([]byte(conversationID))
	return hex.EncodeToString(digest[:16])
}

func normalizeConversationID(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 256 || !utf8.ValidString(value) {
		return "", errors.New("a valid Coding conversation id is required")
	}
	for _, character := range value {
		if unicode.IsControl(character) {
			return "", errors.New("a valid Coding conversation id is required")
		}
	}
	return value, nil
}

func resolveDirectory(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("Coding workspace is required")
	}
	resolved, err := filepath.Abs(value)
	if err != nil {
		return "", fmt.Errorf("resolve Coding workspace: %w", err)
	}
	resolved, err = filepath.EvalSymlinks(resolved)
	if err != nil {
		return "", fmt.Errorf("resolve Coding workspace links: %w", err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("inspect Coding workspace: %w", err)
	}
	if !info.IsDir() {
		return "", errors.New("Coding workspace must be a directory")
	}
	return filepath.Clean(resolved), nil
}

func canonicalExistingPath(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	resolved, err := filepath.Abs(value)
	if err != nil {
		return ""
	}
	resolved, err = filepath.EvalSymlinks(resolved)
	if err != nil {
		return ""
	}
	return filepath.Clean(resolved)
}

func validObjectID(value string) bool {
	if len(value) != 40 && len(value) != 64 {
		return false
	}
	for _, character := range value {
		if character >= '0' && character <= '9' ||
			character >= 'a' && character <= 'f' {
			continue
		}
		return false
	}
	return true
}

func shortHead(value string) string {
	if len(value) > 12 {
		return value[:12]
	}
	return value
}

func statusFromManifest(value manifest) Status {
	return Status{
		SchemaVersion:  value.SchemaVersion,
		ConversationID: value.ConversationID,
		Workspace:      value.Workspace,
		BaseBranch:     value.BaseBranch,
		BaseHead:       value.BaseHead,
		Phase:          value.Phase,
		Active:         value.Phase == phaseActive,
		CreatedAt:      value.CreatedAt,
		UpdatedAt:      value.UpdatedAt,
		CompletedAt:    value.CompletedAt,
		Worktrees:      append([]Worktree(nil), value.Worktrees...),
	}
}

package codingenv

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	codingPullRequestRepository = "MilkSU-Official/milksu"
	codingPullRequestRemote     = "origin"
	pullRequestPreviewLifetime  = 5 * time.Minute
	maxPendingPullRequests      = 16
	maxPullRequestTitleRunes    = 256
	maxPullRequestBodyBytes     = 64 << 10
)

var pullRequestURLPattern = regexp.MustCompile(
	`^https://github\.com/MilkSU-Official/milksu/pull/([1-9][0-9]*)$`,
)

type PullRequestPreview struct {
	Repository        string `json:"repository"`
	RepositoryURL     string `json:"repositoryUrl"`
	Private           bool   `json:"private"`
	Remote            string `json:"remote"`
	SourceBranch      string `json:"sourceBranch"`
	HeadCommit        string `json:"headCommit"`
	TargetBranch      string `json:"targetBranch"`
	SuggestedTitle    string `json:"suggestedTitle"`
	Draft             bool   `json:"draft"`
	ExistingNumber    int    `json:"existingNumber,omitempty"`
	ExistingURL       string `json:"existingUrl,omitempty"`
	ConfirmationToken string `json:"confirmationToken"`
	ExpiresAt         string `json:"expiresAt"`
}

type PullRequestPublishResult struct {
	Repository   string `json:"repository"`
	SourceBranch string `json:"sourceBranch"`
	HeadCommit   string `json:"headCommit"`
	TargetBranch string `json:"targetBranch"`
	Number       int    `json:"number"`
	URL          string `json:"url"`
	State        string `json:"state"`
	Draft        bool   `json:"draft"`
	Created      bool   `json:"created"`
	Verified     bool   `json:"verified"`
	Problem      string `json:"problem,omitempty"`
}

type pullRequestState struct {
	Workspace      string
	Repository     string
	RepositoryURL  string
	SourceBranch   string
	HeadCommit     string
	TargetBranch   string
	SuggestedTitle string
	ExistingNumber int
	ExistingURL    string
}

type pullRequestBackend interface {
	Inspect(context.Context, string) (pullRequestState, error)
	CreateDraft(
		context.Context,
		pullRequestState,
		string,
		string,
	) (PullRequestPublishResult, error)
}

type pendingPullRequest struct {
	state     pullRequestState
	expiresAt time.Time
}

type PullRequestPublisher struct {
	mu          sync.Mutex
	backend     pullRequestBackend
	now         func() time.Time
	randomToken func() (string, error)
	pending     map[string]pendingPullRequest
}

func NewPullRequestPublisher() *PullRequestPublisher {
	return newPullRequestPublisher(
		&githubPullRequestBackend{runner: execHostedCommandRunner{}},
		time.Now,
		randomPullRequestToken,
	)
}

func newPullRequestPublisher(
	backend pullRequestBackend,
	now func() time.Time,
	randomToken func() (string, error),
) *PullRequestPublisher {
	return &PullRequestPublisher{
		backend:     backend,
		now:         now,
		randomToken: randomToken,
		pending:     make(map[string]pendingPullRequest),
	}
}

func (publisher *PullRequestPublisher) Prepare(
	ctx context.Context,
	workspace string,
) (PullRequestPreview, error) {
	state, err := publisher.backend.Inspect(ctx, workspace)
	if err != nil {
		return PullRequestPreview{}, err
	}
	token, err := publisher.randomToken()
	if err != nil {
		return PullRequestPreview{}, fmt.Errorf("prepare pull request confirmation: %w", err)
	}
	now := publisher.now().UTC()
	expiresAt := now.Add(pullRequestPreviewLifetime)

	publisher.mu.Lock()
	publisher.pruneLocked(now)
	if len(publisher.pending) >= maxPendingPullRequests {
		var oldestToken string
		var oldestExpiry time.Time
		for candidate, pending := range publisher.pending {
			if oldestToken == "" || pending.expiresAt.Before(oldestExpiry) {
				oldestToken = candidate
				oldestExpiry = pending.expiresAt
			}
		}
		delete(publisher.pending, oldestToken)
	}
	publisher.pending[token] = pendingPullRequest{
		state:     state,
		expiresAt: expiresAt,
	}
	publisher.mu.Unlock()

	return PullRequestPreview{
		Repository:        state.Repository,
		RepositoryURL:     state.RepositoryURL,
		Private:           true,
		Remote:            codingPullRequestRemote,
		SourceBranch:      state.SourceBranch,
		HeadCommit:        state.HeadCommit,
		TargetBranch:      state.TargetBranch,
		SuggestedTitle:    state.SuggestedTitle,
		Draft:             true,
		ExistingNumber:    state.ExistingNumber,
		ExistingURL:       state.ExistingURL,
		ConfirmationToken: token,
		ExpiresAt:         expiresAt.Format(time.RFC3339),
	}, nil
}

func (publisher *PullRequestPublisher) Publish(
	ctx context.Context,
	workspace,
	confirmationToken,
	title,
	body string,
) (PullRequestPublishResult, error) {
	now := publisher.now().UTC()
	publisher.mu.Lock()
	publisher.pruneLocked(now)
	pending, exists := publisher.pending[strings.TrimSpace(confirmationToken)]
	if exists {
		delete(publisher.pending, strings.TrimSpace(confirmationToken))
	}
	publisher.mu.Unlock()
	if !exists {
		return PullRequestPublishResult{}, errors.New(
			"pull request confirmation is missing, expired, or already used; prepare it again",
		)
	}

	normalizedTitle, err := normalizePullRequestTitle(title)
	if err != nil {
		return PullRequestPublishResult{}, err
	}
	normalizedBody, err := normalizePullRequestBody(body)
	if err != nil {
		return PullRequestPublishResult{}, err
	}
	current, err := publisher.backend.Inspect(ctx, workspace)
	if err != nil {
		return PullRequestPublishResult{}, err
	}
	if !samePullRequestState(pending.state, current) {
		return PullRequestPublishResult{}, errors.New(
			"pull request preview is stale because the repository, branch, commit, or target changed; prepare it again",
		)
	}
	return publisher.backend.CreateDraft(
		ctx,
		current,
		normalizedTitle,
		normalizedBody,
	)
}

func (publisher *PullRequestPublisher) pruneLocked(now time.Time) {
	for token, pending := range publisher.pending {
		if !pending.expiresAt.After(now) {
			delete(publisher.pending, token)
		}
	}
}

func samePullRequestState(first, second pullRequestState) bool {
	return first.Workspace == second.Workspace &&
		first.Repository == second.Repository &&
		first.RepositoryURL == second.RepositoryURL &&
		first.SourceBranch == second.SourceBranch &&
		first.HeadCommit == second.HeadCommit &&
		first.TargetBranch == second.TargetBranch &&
		first.ExistingNumber == second.ExistingNumber &&
		first.ExistingURL == second.ExistingURL
}

func randomPullRequestToken() (string, error) {
	value := make([]byte, 24)
	if _, err := io.ReadFull(rand.Reader, value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func normalizePullRequestTitle(value string) (string, error) {
	title := strings.TrimSpace(strings.ReplaceAll(value, "\r\n", "\n"))
	if title == "" {
		return "", errors.New("pull request title is required")
	}
	if strings.ContainsRune(title, '\x00') || strings.ContainsAny(title, "\r\n") {
		return "", errors.New("pull request title must be one line without null bytes")
	}
	for _, character := range title {
		if unicode.IsControl(character) {
			return "", errors.New("pull request title contains a control character")
		}
	}
	if utf8.RuneCountInString(title) > maxPullRequestTitleRunes {
		return "", fmt.Errorf(
			"pull request title must be at most %d characters",
			maxPullRequestTitleRunes,
		)
	}
	return title, nil
}

func normalizePullRequestBody(value string) (string, error) {
	body := strings.TrimSpace(strings.ReplaceAll(value, "\r\n", "\n"))
	if strings.ContainsRune(body, '\x00') {
		return "", errors.New("pull request body contains an invalid null byte")
	}
	if len(body) > maxPullRequestBodyBytes {
		return "", fmt.Errorf(
			"pull request body must be at most %d bytes",
			maxPullRequestBodyBytes,
		)
	}
	return body, nil
}

type hostedCommandRunner interface {
	Run(
		context.Context,
		string,
		string,
		string,
		...string,
	) (string, error)
}

type execHostedCommandRunner struct{}

func (execHostedCommandRunner) Run(
	ctx context.Context,
	workspace,
	input,
	program string,
	arguments ...string,
) (string, error) {
	path, err := exec.LookPath(program)
	if err != nil {
		if program == "gh" {
			return "", errors.New("GitHub CLI is not installed or unavailable")
		}
		return "", fmt.Errorf("%s is not installed or unavailable", program)
	}
	command := exec.CommandContext(ctx, path, arguments...)
	command.Dir = workspace
	command.Stdin = strings.NewReader(input)
	output, err := command.CombinedOutput()
	if len(output) > maxGitOutputBytes {
		return "", fmt.Errorf("%s output exceeded %d bytes", program, maxGitOutputBytes)
	}
	if err != nil {
		detail := sanitizedGitOutput(string(output))
		if detail == "" {
			detail = boundedProblem(err)
		}
		return "", fmt.Errorf("%s failed: %s", program, detail)
	}
	return string(output), nil
}

type githubPullRequestBackend struct {
	runner hostedCommandRunner
}

type githubRepositoryView struct {
	NameWithOwner    string `json:"nameWithOwner"`
	IsPrivate        bool   `json:"isPrivate"`
	URL              string `json:"url"`
	DefaultBranchRef struct {
		Name string `json:"name"`
	} `json:"defaultBranchRef"`
}

type githubBranchView struct {
	Commit struct {
		SHA string `json:"sha"`
	} `json:"commit"`
}

type githubPullRequestView struct {
	Number      int    `json:"number"`
	URL         string `json:"url"`
	State       string `json:"state"`
	IsDraft     bool   `json:"isDraft"`
	HeadRefName string `json:"headRefName"`
	HeadRefOID  string `json:"headRefOid"`
	BaseRefName string `json:"baseRefName"`
}

func (backend *githubPullRequestBackend) Inspect(
	ctx context.Context,
	workspace string,
) (pullRequestState, error) {
	resolved, err := resolveWorkspace(workspace)
	if err != nil {
		return pullRequestState{}, err
	}
	run := func(program string, arguments ...string) (string, error) {
		return backend.runner.Run(ctx, resolved, "", program, arguments...)
	}
	if _, err := run("git", "rev-parse", "--is-inside-work-tree"); err != nil {
		return pullRequestState{}, errors.New("Coding workspace is not a Git repository")
	}
	status, err := run(
		"git",
		"status",
		"--porcelain=v1",
		"--untracked-files=normal",
	)
	if err != nil {
		return pullRequestState{}, fmt.Errorf("inspect Git worktree: %w", err)
	}
	if strings.TrimSpace(status) != "" {
		return pullRequestState{}, errors.New(
			"commit or discard all Git changes before preparing a pull request",
		)
	}
	sourceBranch, err := run("git", "symbolic-ref", "--quiet", "--short", "HEAD")
	if err != nil || strings.TrimSpace(sourceBranch) == "" {
		return pullRequestState{}, errors.New(
			"select a local Git branch before preparing a pull request",
		)
	}
	sourceBranch = strings.TrimSpace(sourceBranch)
	upstream, err := run(
		"git",
		"rev-parse",
		"--abbrev-ref",
		"--symbolic-full-name",
		"@{upstream}",
	)
	if err != nil ||
		strings.TrimSpace(upstream) != codingPullRequestRemote+"/"+sourceBranch {
		return pullRequestState{}, errors.New(
			"push the current branch to the authorized origin before preparing a pull request",
		)
	}
	remoteURL, err := run("git", "remote", "get-url", codingPullRequestRemote)
	if err != nil {
		return pullRequestState{}, errors.New("the repository has no origin remote")
	}
	repository, err := canonicalMilkSURemote(strings.TrimSpace(remoteURL))
	if err != nil {
		return pullRequestState{}, err
	}
	headCommit, err := run("git", "rev-parse", "HEAD")
	if err != nil || !validGitOID(strings.TrimSpace(headCommit)) {
		return pullRequestState{}, errors.New("cannot resolve the current Git commit")
	}
	headCommit = strings.ToLower(strings.TrimSpace(headCommit))
	suggestedTitle, err := run("git", "log", "-1", "--format=%s")
	if err != nil {
		return pullRequestState{}, fmt.Errorf("read current commit title: %w", err)
	}
	suggestedTitle, err = normalizePullRequestTitle(suggestedTitle)
	if err != nil {
		return pullRequestState{}, fmt.Errorf("use the current commit as pull request title: %w", err)
	}

	repositoryOutput, err := run(
		"gh",
		"repo",
		"view",
		repository,
		"--json",
		"nameWithOwner,isPrivate,defaultBranchRef,url",
	)
	if err != nil {
		return pullRequestState{}, fmt.Errorf("verify authorized GitHub repository: %w", err)
	}
	var repositoryView githubRepositoryView
	if err := json.Unmarshal([]byte(repositoryOutput), &repositoryView); err != nil {
		return pullRequestState{}, errors.New(
			"GitHub CLI returned an invalid repository verification response",
		)
	}
	if !strings.EqualFold(repositoryView.NameWithOwner, codingPullRequestRepository) ||
		!repositoryView.IsPrivate ||
		repositoryView.URL != "https://github.com/"+codingPullRequestRepository {
		return pullRequestState{}, errors.New(
			"pull requests are allowed only for the verified private MilkSU repository",
		)
	}
	targetBranch := strings.TrimSpace(repositoryView.DefaultBranchRef.Name)
	if targetBranch == "" || targetBranch == sourceBranch {
		return pullRequestState{}, errors.New(
			"the current branch cannot target the repository default branch",
		)
	}

	branchOutput, err := run(
		"gh",
		"api",
		"repos/"+codingPullRequestRepository+"/branches/"+url.PathEscape(sourceBranch),
	)
	if err != nil {
		return pullRequestState{}, errors.New(
			"the current branch is not available on the authorized GitHub repository; push it first",
		)
	}
	var branchView githubBranchView
	if err := json.Unmarshal([]byte(branchOutput), &branchView); err != nil ||
		!validGitOID(branchView.Commit.SHA) {
		return pullRequestState{}, errors.New(
			"GitHub CLI returned an invalid remote branch response",
		)
	}
	if !strings.EqualFold(branchView.Commit.SHA, headCommit) {
		return pullRequestState{}, errors.New(
			"the authorized remote branch does not contain the current commit; push it first",
		)
	}

	state := pullRequestState{
		Workspace:      resolved,
		Repository:     codingPullRequestRepository,
		RepositoryURL:  repositoryView.URL,
		SourceBranch:   sourceBranch,
		HeadCommit:     headCommit,
		TargetBranch:   targetBranch,
		SuggestedTitle: suggestedTitle,
	}
	if existing, found := backend.findOpenPullRequest(ctx, state); found {
		state.ExistingNumber = existing.Number
		state.ExistingURL = existing.URL
	}
	return state, nil
}

func (backend *githubPullRequestBackend) CreateDraft(
	ctx context.Context,
	state pullRequestState,
	title,
	body string,
) (PullRequestPublishResult, error) {
	if state.ExistingNumber > 0 && state.ExistingURL != "" {
		return PullRequestPublishResult{
			Repository:   state.Repository,
			SourceBranch: state.SourceBranch,
			HeadCommit:   state.HeadCommit,
			TargetBranch: state.TargetBranch,
			Number:       state.ExistingNumber,
			URL:          state.ExistingURL,
			State:        "OPEN",
			Draft:        true,
			Verified:     true,
		}, nil
	}
	output, err := backend.runner.Run(
		ctx,
		state.Workspace,
		body,
		"gh",
		"pr",
		"create",
		"--repo",
		state.Repository,
		"--base",
		state.TargetBranch,
		"--head",
		state.SourceBranch,
		"--title",
		title,
		"--body-file",
		"-",
		"--draft",
	)
	if err != nil {
		if existing, found := backend.findOpenPullRequest(ctx, state); found {
			existing.Created = false
			return existing, nil
		}
		return PullRequestPublishResult{}, fmt.Errorf("create draft pull request: %w", err)
	}
	pullRequestURL := strings.TrimSpace(output)
	match := pullRequestURLPattern.FindStringSubmatch(pullRequestURL)
	if len(match) != 2 {
		if recovered, found := backend.findOpenPullRequest(ctx, state); found {
			recovered.Created = true
			return recovered, nil
		}
		return PullRequestPublishResult{}, errors.New(
			"GitHub CLI may have created a pull request but returned an unexpected URL; inspect the MilkSU repository before retrying",
		)
	}
	number, err := strconv.Atoi(match[1])
	if err != nil {
		return PullRequestPublishResult{}, errors.New(
			"GitHub CLI returned an invalid pull request number",
		)
	}

	verificationOutput, err := backend.runner.Run(
		ctx,
		state.Workspace,
		"",
		"gh",
		"pr",
		"view",
		pullRequestURL,
		"--repo",
		state.Repository,
		"--json",
		"number,url,state,isDraft,headRefName,headRefOid,baseRefName",
	)
	if err != nil {
		return uncertainPullRequestResult(
			state,
			number,
			pullRequestURL,
			fmt.Sprintf("draft pull request was created but readback failed: %s", err),
		), nil
	}
	var view githubPullRequestView
	if err := json.Unmarshal([]byte(verificationOutput), &view); err != nil {
		return uncertainPullRequestResult(
			state,
			number,
			pullRequestURL,
			"draft pull request was created but GitHub CLI returned an invalid readback response",
		), nil
	}
	if view.Number != number ||
		view.URL != pullRequestURL ||
		view.State != "OPEN" ||
		!view.IsDraft ||
		view.HeadRefName != state.SourceBranch ||
		view.BaseRefName != state.TargetBranch ||
		!strings.EqualFold(view.HeadRefOID, state.HeadCommit) {
		return uncertainPullRequestResult(
			state,
			number,
			pullRequestURL,
			"draft pull request was created but its readback did not match the confirmed branches, commit, and draft state",
		), nil
	}
	return PullRequestPublishResult{
		Repository:   state.Repository,
		SourceBranch: state.SourceBranch,
		HeadCommit:   state.HeadCommit,
		TargetBranch: state.TargetBranch,
		Number:       view.Number,
		URL:          view.URL,
		State:        view.State,
		Draft:        view.IsDraft,
		Created:      true,
		Verified:     true,
	}, nil
}

func (backend *githubPullRequestBackend) findOpenPullRequest(
	ctx context.Context,
	state pullRequestState,
) (PullRequestPublishResult, bool) {
	output, err := backend.runner.Run(
		ctx,
		state.Workspace,
		"",
		"gh",
		"pr",
		"list",
		"--repo",
		state.Repository,
		"--head",
		state.SourceBranch,
		"--base",
		state.TargetBranch,
		"--state",
		"open",
		"--limit",
		"5",
		"--json",
		"number,url,state,isDraft,headRefName,headRefOid,baseRefName",
	)
	if err != nil {
		return PullRequestPublishResult{}, false
	}
	var views []githubPullRequestView
	if json.Unmarshal([]byte(output), &views) != nil {
		return PullRequestPublishResult{}, false
	}
	for _, view := range views {
		if view.Number <= 0 ||
			pullRequestURLPattern.FindStringSubmatch(view.URL) == nil ||
			view.State != "OPEN" ||
			!view.IsDraft ||
			view.HeadRefName != state.SourceBranch ||
			view.BaseRefName != state.TargetBranch ||
			!strings.EqualFold(view.HeadRefOID, state.HeadCommit) {
			continue
		}
		return PullRequestPublishResult{
			Repository:   state.Repository,
			SourceBranch: state.SourceBranch,
			HeadCommit:   state.HeadCommit,
			TargetBranch: state.TargetBranch,
			Number:       view.Number,
			URL:          view.URL,
			State:        view.State,
			Draft:        view.IsDraft,
			Verified:     true,
		}, true
	}
	return PullRequestPublishResult{}, false
}

func uncertainPullRequestResult(
	state pullRequestState,
	number int,
	pullRequestURL,
	problem string,
) PullRequestPublishResult {
	return PullRequestPublishResult{
		Repository:   state.Repository,
		SourceBranch: state.SourceBranch,
		HeadCommit:   state.HeadCommit,
		TargetBranch: state.TargetBranch,
		Number:       number,
		URL:          pullRequestURL,
		State:        "UNKNOWN",
		Draft:        true,
		Created:      true,
		Problem:      problem,
	}
}

func canonicalMilkSURemote(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" || strings.ContainsAny(value, "\r\n\x00") {
		return "", errors.New(
			"pull requests are allowed only for the authorized MilkSU origin",
		)
	}
	if strings.HasPrefix(value, "git@github.com:") {
		if strings.EqualFold(
			strings.TrimSuffix(strings.TrimPrefix(value, "git@github.com:"), ".git"),
			codingPullRequestRepository,
		) {
			return codingPullRequestRepository, nil
		}
		return "", errors.New(
			"pull requests are allowed only for the authorized MilkSU origin",
		)
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New(
			"pull requests are allowed only for the authorized MilkSU origin",
		)
	}
	switch parsed.Scheme {
	case "https":
		if parsed.User != nil {
			return "", errors.New(
				"remove embedded credentials from the origin URL before preparing a pull request",
			)
		}
	case "ssh":
		if parsed.User == nil || parsed.User.Username() != "git" ||
			parsed.User.String() != "git" {
			return "", errors.New(
				"pull requests are allowed only for the authorized MilkSU origin",
			)
		}
	default:
		return "", errors.New(
			"pull requests are allowed only for the authorized MilkSU origin",
		)
	}
	if !strings.EqualFold(parsed.Hostname(), "github.com") ||
		parsed.Port() != "" ||
		!strings.EqualFold(
			strings.TrimSuffix(strings.Trim(parsed.Path, "/"), ".git"),
			codingPullRequestRepository,
		) {
		return "", errors.New(
			"pull requests are allowed only for the authorized MilkSU origin",
		)
	}
	return codingPullRequestRepository, nil
}

func validGitOID(value string) bool {
	if len(value) != 40 && len(value) != 64 {
		return false
	}
	for _, character := range value {
		if character >= '0' && character <= '9' ||
			character >= 'a' && character <= 'f' ||
			character >= 'A' && character <= 'F' {
			continue
		}
		return false
	}
	return true
}

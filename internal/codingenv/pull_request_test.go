package codingenv

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

const pullRequestTestOID = "0123456789abcdef0123456789abcdef01234567"

type fakePullRequestBackend struct {
	states      []pullRequestState
	created     int
	createTitle string
	createBody  string
}

func (backend *fakePullRequestBackend) Inspect(
	context.Context,
	string,
) (pullRequestState, error) {
	if len(backend.states) == 0 {
		return pullRequestState{}, errors.New("no fake pull request state")
	}
	state := backend.states[0]
	if len(backend.states) > 1 {
		backend.states = backend.states[1:]
	}
	return state, nil
}

func (backend *fakePullRequestBackend) CreateDraft(
	_ context.Context,
	state pullRequestState,
	title,
	body string,
) (PullRequestPublishResult, error) {
	backend.created++
	backend.createTitle = title
	backend.createBody = body
	return PullRequestPublishResult{
		Repository:   state.Repository,
		SourceBranch: state.SourceBranch,
		HeadCommit:   state.HeadCommit,
		TargetBranch: state.TargetBranch,
		Number:       42,
		URL:          "https://github.com/MilkSU-Official/milksu/pull/42",
		State:        "OPEN",
		Draft:        true,
		Created:      true,
		Verified:     true,
	}, nil
}

func TestPullRequestPublisherRequiresOneTimeFreshConfirmation(t *testing.T) {
	now := time.Date(2026, time.August, 2, 12, 0, 0, 0, time.UTC)
	state := pullRequestState{
		Workspace:      "/workspace",
		Repository:     codingPullRequestRepository,
		RepositoryURL:  "https://github.com/MilkSU-Official/milksu",
		SourceBranch:   "codex/self-hosting",
		HeadCommit:     pullRequestTestOID,
		TargetBranch:   "main",
		SuggestedTitle: "feat: self host",
	}
	backend := &fakePullRequestBackend{states: []pullRequestState{state}}
	publisher := newPullRequestPublisher(
		backend,
		func() time.Time { return now },
		func() (string, error) { return "confirmation-token", nil },
	)

	preview, err := publisher.Prepare(context.Background(), "/workspace")
	if err != nil {
		t.Fatal(err)
	}
	if preview.Repository != codingPullRequestRepository ||
		!preview.Private ||
		preview.SourceBranch != state.SourceBranch ||
		preview.HeadCommit != state.HeadCommit ||
		preview.TargetBranch != "main" ||
		!preview.Draft ||
		preview.ConfirmationToken != "confirmation-token" ||
		preview.ExpiresAt != now.Add(pullRequestPreviewLifetime).Format(time.RFC3339) {
		t.Fatalf("unexpected pull request preview: %#v", preview)
	}

	result, err := publisher.Publish(
		context.Background(),
		"/workspace",
		preview.ConfirmationToken,
		"feat: confirmed self host",
		"Tests passed.",
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Number != 42 || !result.Draft || !result.Created || !result.Verified ||
		backend.created != 1 ||
		backend.createTitle != "feat: confirmed self host" ||
		backend.createBody != "Tests passed." {
		t.Fatalf("unexpected pull request publication: result=%#v backend=%#v", result, backend)
	}
	if _, err := publisher.Publish(
		context.Background(),
		"/workspace",
		preview.ConfirmationToken,
		"retry",
		"",
	); err == nil || !strings.Contains(err.Error(), "already used") {
		t.Fatalf("expected one-time confirmation refusal, got %v", err)
	}
}

func TestPullRequestPublisherRejectsStaleAndExpiredPreviews(t *testing.T) {
	now := time.Date(2026, time.August, 2, 12, 0, 0, 0, time.UTC)
	state := pullRequestState{
		Workspace:      "/workspace",
		Repository:     codingPullRequestRepository,
		RepositoryURL:  "https://github.com/MilkSU-Official/milksu",
		SourceBranch:   "codex/self-hosting",
		HeadCommit:     pullRequestTestOID,
		TargetBranch:   "main",
		SuggestedTitle: "feat: self host",
	}
	changed := state
	changed.HeadCommit = "1123456789abcdef0123456789abcdef01234567"
	backend := &fakePullRequestBackend{
		states: []pullRequestState{state, changed},
	}
	tokenSequence := 0
	publisher := newPullRequestPublisher(
		backend,
		func() time.Time { return now },
		func() (string, error) {
			tokenSequence++
			return fmt.Sprintf("token-%d", tokenSequence), nil
		},
	)
	preview, err := publisher.Prepare(context.Background(), "/workspace")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := publisher.Publish(
		context.Background(),
		"/workspace",
		preview.ConfirmationToken,
		"feat: self host",
		"",
	); err == nil || !strings.Contains(err.Error(), "stale") {
		t.Fatalf("expected stale preview refusal, got %v", err)
	}
	if backend.created != 0 {
		t.Fatal("stale preview created a pull request")
	}

	backend.states = []pullRequestState{state}
	preview, err = publisher.Prepare(context.Background(), "/workspace")
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(pullRequestPreviewLifetime)
	if _, err := publisher.Publish(
		context.Background(),
		"/workspace",
		preview.ConfirmationToken,
		"feat: self host",
		"",
	); err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expected expired preview refusal, got %v", err)
	}
}

func TestCanonicalMilkSURemoteAllowsOnlyExactCredentialFreeOrigin(t *testing.T) {
	allowed := []string{
		"https://github.com/MilkSU-Official/milksu.git",
		"git@github.com:MilkSU-Official/milksu.git",
		"ssh://git@github.com/MilkSU-Official/milksu.git",
	}
	for _, remote := range allowed {
		if repository, err := canonicalMilkSURemote(remote); err != nil ||
			repository != codingPullRequestRepository {
			t.Fatalf("allowed remote %q was rejected: repository=%q err=%v", remote, repository, err)
		}
	}
	rejected := []string{
		"https://github.com/openai/openai.git",
		"https://token@github.com/MilkSU-Official/milksu.git",
		"git@github.com:MilkSU-Official/other.git",
		"ssh://root@github.com/MilkSU-Official/milksu.git",
		"https://github.com/MilkSU-Official/milksu.git?redirect=upstream",
		"/tmp/milksu.git",
	}
	for _, remote := range rejected {
		if repository, err := canonicalMilkSURemote(remote); err == nil {
			t.Fatalf("unsafe remote %q resolved to %q", remote, repository)
		}
	}
}

type hostedCommandCall struct {
	program   string
	arguments []string
	input     string
}

type fakeHostedCommandRunner struct {
	calls       []hostedCommandCall
	createError bool
	viewError   bool
	existing    bool
}

func (runner *fakeHostedCommandRunner) Run(
	_ context.Context,
	_ string,
	input,
	program string,
	arguments ...string,
) (string, error) {
	runner.calls = append(runner.calls, hostedCommandCall{
		program:   program,
		arguments: append([]string(nil), arguments...),
		input:     input,
	})
	joined := strings.Join(arguments, " ")
	switch {
	case program == "git" && joined == "rev-parse --is-inside-work-tree":
		return "true\n", nil
	case program == "git" && strings.HasPrefix(joined, "status "):
		return "", nil
	case program == "git" && joined == "symbolic-ref --quiet --short HEAD":
		return "codex/self-hosting\n", nil
	case program == "git" &&
		joined == "rev-parse --abbrev-ref --symbolic-full-name @{upstream}":
		return "origin/codex/self-hosting\n", nil
	case program == "git" && joined == "remote get-url origin":
		return "https://github.com/MilkSU-Official/milksu.git\n", nil
	case program == "git" && joined == "rev-parse HEAD":
		return pullRequestTestOID + "\n", nil
	case program == "git" && joined == "log -1 --format=%s":
		return "feat: self host\n", nil
	case program == "gh" && strings.HasPrefix(joined, "repo view "):
		return `{"nameWithOwner":"MilkSU-Official/milksu","isPrivate":true,` +
			`"url":"https://github.com/MilkSU-Official/milksu",` +
			`"defaultBranchRef":{"name":"main"}}`, nil
	case program == "gh" && strings.HasPrefix(joined, "api repos/"):
		return `{"commit":{"sha":"` + pullRequestTestOID + `"}}`, nil
	case program == "gh" && strings.HasPrefix(joined, "pr create "):
		if runner.createError {
			return "", errors.New("a pull request already exists")
		}
		return "https://github.com/MilkSU-Official/milksu/pull/42\n", nil
	case program == "gh" && strings.HasPrefix(joined, "pr view "):
		if runner.viewError {
			return "", errors.New("temporary readback failure")
		}
		return `{"number":42,"url":"https://github.com/MilkSU-Official/milksu/pull/42",` +
			`"state":"OPEN","isDraft":true,"headRefName":"codex/self-hosting",` +
			`"headRefOid":"` + pullRequestTestOID + `","baseRefName":"main"}`, nil
	case program == "gh" && strings.HasPrefix(joined, "pr list "):
		if !runner.existing {
			return "[]", nil
		}
		return `[{"number":42,"url":"https://github.com/MilkSU-Official/milksu/pull/42",` +
			`"state":"OPEN","isDraft":true,"headRefName":"codex/self-hosting",` +
			`"headRefOid":"` + pullRequestTestOID + `","baseRefName":"main"}]`, nil
	default:
		return "", fmt.Errorf("unexpected command: %s %s", program, joined)
	}
}

func TestGitHubPullRequestBackendRecoversExistingAndUncertainEffects(t *testing.T) {
	existingRunner := &fakeHostedCommandRunner{
		createError: true,
		existing:    true,
	}
	existingBackend := &githubPullRequestBackend{runner: existingRunner}
	state, err := existingBackend.Inspect(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	existing, err := existingBackend.CreateDraft(
		context.Background(),
		state,
		"feat: confirmed",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	if existing.Created || !existing.Verified || existing.Number != 42 {
		t.Fatalf("existing pull request was not recovered safely: %#v", existing)
	}

	uncertainRunner := &fakeHostedCommandRunner{viewError: true}
	uncertainBackend := &githubPullRequestBackend{runner: uncertainRunner}
	state, err = uncertainBackend.Inspect(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	uncertain, err := uncertainBackend.CreateDraft(
		context.Background(),
		state,
		"feat: confirmed",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	if !uncertain.Created || uncertain.Verified ||
		uncertain.State != "UNKNOWN" ||
		uncertain.Number != 42 ||
		!strings.Contains(uncertain.Problem, "readback failed") {
		t.Fatalf("uncertain external effect was overstated: %#v", uncertain)
	}
}

func TestGitHubPullRequestBackendUsesNarrowDraftAndVerifiesReadback(t *testing.T) {
	runner := &fakeHostedCommandRunner{}
	backend := &githubPullRequestBackend{runner: runner}
	state, err := backend.Inspect(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	result, err := backend.CreateDraft(
		context.Background(),
		state,
		"feat: confirmed",
		"Verified tests.",
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Number != 42 || !result.Draft || !result.Created ||
		!result.Verified || result.HeadCommit != pullRequestTestOID {
		t.Fatalf("unexpected verified pull request: %#v", result)
	}
	var createCall *hostedCommandCall
	for index := range runner.calls {
		if runner.calls[index].program == "gh" &&
			len(runner.calls[index].arguments) >= 2 &&
			runner.calls[index].arguments[0] == "pr" &&
			runner.calls[index].arguments[1] == "create" {
			createCall = &runner.calls[index]
			break
		}
	}
	if createCall == nil {
		t.Fatal("GitHub CLI draft creation was not called")
	}
	arguments := strings.Join(createCall.arguments, " ")
	for _, expected := range []string{
		"--repo MilkSU-Official/milksu",
		"--base main",
		"--head codex/self-hosting",
		"--body-file -",
		"--draft",
	} {
		if !strings.Contains(arguments, expected) {
			t.Fatalf("draft creation omitted %q: %s", expected, arguments)
		}
	}
	if createCall.input != "Verified tests." {
		t.Fatalf("pull request body was not sent through stdin: %q", createCall.input)
	}
}

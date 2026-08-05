package labmanager

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
)

type fakeRunner struct {
	commands     []string
	environments [][]string
	judgeOutput  []byte
	judgeExit    int
	statusOutput []byte
	statusExit   int
	healthOutput []byte
	healthExit   int
}

func (r *fakeRunner) Run(_ context.Context, _ string, args, environment []string, _ string) ([]byte, error) {
	r.commands = append(r.commands, strings.Join(args, " "))
	r.environments = append(r.environments, append([]string{}, environment...))
	port := environmentValue(environment, "MILKSU_CTF_PORT")
	project := environmentValue(environment, "MILKSU_LAB_PROJECT_ID")
	stateDirectory := environmentValue(environment, "MILKSU_LAB_STATE_DIR")
	if port == "" || project == "" || stateDirectory == "" {
		return nil, os.ErrInvalid
	}
	info, err := os.Stat(stateDirectory)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0o700 {
		return nil, os.ErrPermission
	}
	if len(args) > 0 {
		switch args[0] {
		case "judge":
			output := r.judgeOutput
			if output == nil {
				output = []byte("solved")
			}
			if r.judgeExit != 0 {
				return output, fakeExitError(r.judgeExit)
			}
			return output, nil
		case "status":
			output := r.statusOutput
			if output == nil {
				output = []byte("running")
			}
			if r.statusExit != 0 {
				return output, fakeExitError(r.statusExit)
			}
			return output, nil
		case "health":
			output := r.healthOutput
			if output == nil {
				output = []byte("healthy")
			}
			if r.healthExit != 0 {
				return output, fakeExitError(r.healthExit)
			}
			return output, nil
		case "start", "reset":
			accessPath := filepath.Join(stateDirectory, "access.json")
			if err := os.WriteFile(
				accessPath,
				[]byte(`{"username":"milksu_test","password":"temporary_password"}`),
				0o600,
			); err != nil {
				return nil, err
			}
		}
	}
	return []byte("ready " + port + " " + project), nil
}

type fakeExitError int

func (e fakeExitError) Error() string { return "process exited" }
func (e fakeExitError) ExitCode() int { return int(e) }

func TestManagerOwnsPerInstanceLabLifecycle(t *testing.T) {
	runner := &fakeRunner{}
	manager, err := newManager(t.TempDir(), runner)
	if err != nil {
		t.Fatal(err)
	}
	state, err := manager.Start(context.Background(), JuiceShopPackageID)
	if err != nil {
		t.Fatal(err)
	}
	if state.InstanceID == "" || state.ProjectName == "" || state.Phase != "ready" ||
		!strings.HasPrefix(state.Endpoint, "http://127.0.0.1:") || len(state.Scope.Targets) != 2 ||
		state.PackageVersion != "v20.1.1" || !strings.HasPrefix(state.ImageDigest, "sha256:") {
		t.Fatalf("unexpected managed lab state: %#v", state)
	}
	stateDirectory := environmentValue(runner.environments[0], "MILKSU_LAB_STATE_DIR")
	resetMarker := filepath.Join(stateDirectory, "credential.json")
	if err := os.WriteFile(resetMarker, []byte("temporary"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Reset(context.Background(), state.InstanceID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(resetMarker); !os.IsNotExist(err) {
		t.Fatalf("reset retained private instance state: %v", err)
	}
	stopMarker := filepath.Join(stateDirectory, "session.json")
	if err := os.WriteFile(stopMarker, []byte("preserve-on-stop"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Stop(context.Background(), state.InstanceID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(stopMarker); err != nil {
		t.Fatalf("stop discarded private instance state: %v", err)
	}
	if _, err := manager.Stop(context.Background(), state.InstanceID); err != nil {
		t.Fatal(err)
	}
	cleaned, err := manager.Clean(context.Background(), state.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Clean(context.Background(), state.InstanceID); err != nil {
		t.Fatal(err)
	}
	if cleaned.Phase != "cleaned" || cleaned.Endpoint != "" || cleaned.Port != 0 || len(cleaned.Scope.Targets) != 0 {
		t.Fatalf("cleanup retained runtime authority: %#v", cleaned)
	}
	if _, err := os.Stat(stateDirectory); !os.IsNotExist(err) {
		t.Fatalf("cleanup retained private instance state: %v", err)
	}
	want := []string{"pull", "start", "reset", "stop", "clean"}
	if strings.Join(runner.commands, ",") != strings.Join(want, ",") {
		t.Fatalf("unexpected lifecycle commands: %v", runner.commands)
	}
}

func TestManagerStartsIsolatedInstances(t *testing.T) {
	runner := &fakeRunner{}
	manager, err := newManager(t.TempDir(), runner)
	if err != nil {
		t.Fatal(err)
	}
	first, err := manager.Start(context.Background(), JuiceShopPackageID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := manager.Start(context.Background(), JuiceShopPackageID)
	if err != nil {
		t.Fatal(err)
	}
	if first.InstanceID == second.InstanceID || first.ProjectName == second.ProjectName {
		t.Fatalf("instances share runtime identity: %#v %#v", first, second)
	}
	if len(manager.ListInstances()) != 2 {
		t.Fatalf("expected two persisted instances, got %#v", manager.ListInstances())
	}
	projects := map[string]bool{}
	for _, environment := range runner.environments {
		projects[environmentValue(environment, "MILKSU_LAB_PROJECT_ID")] = true
	}
	if !projects[first.ProjectName] || !projects[second.ProjectName] {
		t.Fatalf("commands did not receive isolated projects: %#v", projects)
	}
	stateDirectories := map[string]bool{}
	for _, environment := range runner.environments {
		stateDirectories[environmentValue(environment, "MILKSU_LAB_STATE_DIR")] = true
	}
	if len(stateDirectories) != 2 {
		t.Fatalf("instances share private state directories: %#v", stateDirectories)
	}
}

func TestManagerJudgeDistinguishesUnsolvedFromExecutionFailure(t *testing.T) {
	runner := &fakeRunner{judgeOutput: []byte("not solved: Confidential Document"), judgeExit: 1}
	manager, err := newManager(t.TempDir(), runner)
	if err != nil {
		t.Fatal(err)
	}
	started, err := manager.Start(context.Background(), JuiceShopPackageID)
	if err != nil {
		t.Fatal(err)
	}
	result, err := manager.Judge(context.Background(), started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Completed || result.Solved || result.JudgeType != "application-oracle" ||
		result.Challenge != "Confidential Document" ||
		result.Reference != started.Endpoint+"/api/Challenges/" ||
		result.CheckedAt.IsZero() ||
		!strings.Contains(result.Summary, "not solved") {
		t.Fatalf("unexpected authoritative judge result: %#v", result)
	}
	if got := runner.commands[len(runner.commands)-1]; got != "judge Confidential Document" {
		t.Fatalf("judge did not use the manifest challenge: %q", got)
	}

	runner.judgeOutput = []byte("solved: Confidential Document")
	runner.judgeExit = 0
	solved, err := manager.Judge(context.Background(), started.InstanceID)
	if err != nil || !solved.Completed || !solved.Solved {
		t.Fatalf("successful oracle did not become a solved result: %#v err=%v", solved, err)
	}

	runner.judgeExit = 2
	if failed, err := manager.Judge(context.Background(), started.InstanceID); err == nil || failed.Completed {
		t.Fatalf("judge execution failure became a challenge result: %#v err=%v", failed, err)
	}
}

func TestManagerWebGoatUsesPrivateAccessAndExactAssignmentOracle(t *testing.T) {
	runner := &fakeRunner{}
	manager, err := newManager(t.TempDir(), runner)
	if err != nil {
		t.Fatal(err)
	}
	started, err := manager.Start(context.Background(), WebGoatPackageID)
	if err != nil {
		t.Fatal(err)
	}
	access, err := manager.Access(started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if access.Username != "milksu_test" || access.Password != "temporary_password" ||
		access.Type != "form" || !strings.HasSuffix(access.LoginURL, "/WebGoat/login") {
		t.Fatalf("unexpected private WebGoat access: %#v", access)
	}
	launchURL, err := manager.LaunchURL(started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(launchURL, "/WebGoat/attack#lesson/SqlInjection.lesson") {
		t.Fatalf("unexpected WebGoat launch URL: %q", launchURL)
	}

	allSolved := false
	expectedAssignments := manager.packages[WebGoatPackageID].manifest.Spec.Judge.ExpectedAssignments
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/WebGoat/login":
			if err := request.ParseForm(); err != nil ||
				request.Form.Get("username") != "milksu_test" ||
				request.Form.Get("password") != "temporary_password" {
				http.Error(response, "bad credentials", http.StatusUnauthorized)
				return
			}
			http.SetCookie(response, &http.Cookie{Name: "JSESSIONID", Value: "judge-session", Path: "/"})
			response.Header().Set("Location", "/WebGoat/")
			response.WriteHeader(http.StatusFound)
		case "/WebGoat/service/lessonoverview.mvc/SqlInjection.lesson":
			cookie, err := request.Cookie("JSESSIONID")
			if err != nil || cookie.Value != "judge-session" {
				http.Error(response, "missing session", http.StatusUnauthorized)
				return
			}
			type assignment struct {
				Assignment struct {
					Name string `json:"name"`
				} `json:"assignment"`
				Solved bool `json:"solved"`
			}
			receipt := make([]assignment, 0, len(expectedAssignments))
			for _, name := range expectedAssignments {
				item := assignment{Solved: allSolved}
				item.Assignment.Name = name
				receipt = append(receipt, item)
			}
			response.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(response).Encode(receipt)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	scope, err := securitypolicy.NewGrant(
		"managed-lab:"+started.InstanceID,
		"ctf training",
		[]securitypolicy.Target{
			{Kind: securitypolicy.TargetLab, Value: started.InstanceID},
			{Kind: securitypolicy.TargetOrigin, Value: server.URL},
		},
		time.Hour,
	)
	if err != nil {
		t.Fatal(err)
	}
	state := manager.instances[started.InstanceID]
	state.Endpoint = server.URL
	state.Scope = scope
	manager.instances[started.InstanceID] = state

	unsolved, err := manager.Judge(context.Background(), started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if !unsolved.Completed || unsolved.Solved || unsolved.ReceiptSHA256 == "" ||
		!strings.Contains(unsolved.Summary, "0/9") {
		t.Fatalf("unexpected unsolved WebGoat receipt: %#v", unsolved)
	}
	allSolved = true
	solved, err := manager.Judge(context.Background(), started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if !solved.Completed || !solved.Solved || !strings.Contains(solved.Summary, "9/9") {
		t.Fatalf("unexpected solved WebGoat receipt: %#v", solved)
	}
}

func TestManagerJudgeRequiresReadyInstanceAndExactOriginScope(t *testing.T) {
	runner := &fakeRunner{}
	manager, err := newManager(t.TempDir(), runner)
	if err != nil {
		t.Fatal(err)
	}
	started, err := manager.Start(context.Background(), JuiceShopPackageID)
	if err != nil {
		t.Fatal(err)
	}
	state := manager.instances[started.InstanceID]
	state.Scope.Targets[1].Value = "http://127.0.0.1:1"
	manager.instances[started.InstanceID] = state
	commandCount := len(runner.commands)
	if _, err := manager.Judge(context.Background(), started.InstanceID); err == nil {
		t.Fatal("judge ignored the exact origin scope")
	}
	if len(runner.commands) != commandCount {
		t.Fatal("denied judge still executed the package lifecycle")
	}

	state.Scope = started.Scope
	state.Phase = "stopped"
	manager.instances[started.InstanceID] = state
	if _, err := manager.Judge(context.Background(), started.InstanceID); err == nil {
		t.Fatal("judge ran against a non-ready instance")
	}
}

func TestManagerRecoversPersistedActiveInstanceAsOrphaned(t *testing.T) {
	root := t.TempDir()
	firstManager, err := newManager(root, &fakeRunner{})
	if err != nil {
		t.Fatal(err)
	}
	started, err := firstManager.Start(context.Background(), JuiceShopPackageID)
	if err != nil {
		t.Fatal(err)
	}

	recoveryRunner := &fakeRunner{}
	recoveredManager, err := newManager(root, recoveryRunner)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := recoveredManager.Status(started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Phase != "orphaned" || !recovered.RecoveryPending ||
		recovered.ProjectName != started.ProjectName || recovered.Port != started.Port ||
		recovered.PackageVersion != started.PackageVersion || recovered.ImageDigest != started.ImageDigest {
		t.Fatalf("active instance was not recovered safely: %#v", recovered)
	}
	cleaned, err := recoveredManager.Clean(context.Background(), started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if cleaned.Phase != "cleaned" || cleaned.RecoveryPending {
		t.Fatalf("orphaned instance was not cleaned: %#v", cleaned)
	}
	if got := environmentValue(recoveryRunner.environments[0], "MILKSU_LAB_PROJECT_ID"); got != started.ProjectName {
		t.Fatalf("recovery targeted %q, want exact project %q", got, started.ProjectName)
	}
}

func TestManagerReconcileRestoresOnlyHealthyPersistedInstance(t *testing.T) {
	root := t.TempDir()
	firstManager, err := newManager(root, &fakeRunner{})
	if err != nil {
		t.Fatal(err)
	}
	started, err := firstManager.Start(context.Background(), JuiceShopPackageID)
	if err != nil {
		t.Fatal(err)
	}

	reconcileRunner := &fakeRunner{}
	recoveredManager, err := newManager(root, reconcileRunner)
	if err != nil {
		t.Fatal(err)
	}
	instances, err := recoveredManager.Reconcile(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(instances) != 1 {
		t.Fatalf("unexpected reconciled instance count: %#v", instances)
	}
	recovered, err := recoveredManager.Status(started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Phase != "ready" || recovered.RecoveryPending ||
		recovered.Endpoint != started.Endpoint || recovered.ProjectName != started.ProjectName ||
		recovered.Port != started.Port {
		t.Fatalf("healthy persisted instance was not restored: %#v", recovered)
	}
	if strings.Join(reconcileRunner.commands, ",") != "status,health" {
		t.Fatalf("reconcile ran unexpected lifecycle commands: %#v", reconcileRunner.commands)
	}
	for _, environment := range reconcileRunner.environments {
		if environmentValue(environment, "MILKSU_LAB_PROJECT_ID") != started.ProjectName ||
			environmentValue(environment, "MILKSU_CTF_PORT") == "" ||
			environmentValue(environment, "MILKSU_LAB_STATE_DIR") == "" {
			t.Fatalf("reconcile lost exact persisted runtime identity: %#v", environment)
		}
	}
}

func TestManagerReconcileDoesNotRecreateMissingPrivateState(t *testing.T) {
	root := t.TempDir()
	firstManager, err := newManager(root, &fakeRunner{})
	if err != nil {
		t.Fatal(err)
	}
	started, err := firstManager.Start(context.Background(), JuiceShopPackageID)
	if err != nil {
		t.Fatal(err)
	}
	stateDirectory := firstManager.instanceStateDirectory(started.InstanceID)
	if err := os.RemoveAll(stateDirectory); err != nil {
		t.Fatal(err)
	}

	reconcileRunner := &fakeRunner{}
	recoveredManager, err := newManager(root, reconcileRunner)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := recoveredManager.Reconcile(context.Background()); err != nil {
		t.Fatal(err)
	}
	recovered, err := recoveredManager.Status(started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Phase != "orphaned" || !recovered.RecoveryPending ||
		!strings.Contains(recovered.Message, "私有状态") {
		t.Fatalf("missing private state was silently recovered: %#v", recovered)
	}
	if len(reconcileRunner.commands) != 0 {
		t.Fatalf("missing private state still reached the runtime: %#v", reconcileRunner.commands)
	}
	if _, err := os.Stat(stateDirectory); !os.IsNotExist(err) {
		t.Fatalf("reconcile recreated missing private state: %v", err)
	}
}

func TestManagerReconcileLeavesUnhealthyInstanceOrphaned(t *testing.T) {
	root := t.TempDir()
	firstManager, err := newManager(root, &fakeRunner{})
	if err != nil {
		t.Fatal(err)
	}
	started, err := firstManager.Start(context.Background(), JuiceShopPackageID)
	if err != nil {
		t.Fatal(err)
	}

	reconcileRunner := &fakeRunner{healthOutput: []byte("connection refused"), healthExit: 1}
	recoveredManager, err := newManager(root, reconcileRunner)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := recoveredManager.Reconcile(context.Background()); err != nil {
		t.Fatal(err)
	}
	recovered, err := recoveredManager.Status(started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Phase != "orphaned" || !recovered.RecoveryPending ||
		!strings.Contains(recovered.Message, "connection refused") {
		t.Fatalf("unhealthy persisted instance escaped recovery state: %#v", recovered)
	}
	if strings.Join(reconcileRunner.commands, ",") != "status,health" {
		t.Fatalf("unhealthy reconcile ran unexpected commands: %#v", reconcileRunner.commands)
	}
}

func TestManagerCatalogComesFromValidatedManifest(t *testing.T) {
	manager, err := newManager(t.TempDir(), &fakeRunner{})
	if err != nil {
		t.Fatal(err)
	}
	catalog := manager.Catalog()
	if len(catalog) != 2 || catalog[0].ID != JuiceShopPackageID || catalog[0].Version != "v20.1.1" ||
		catalog[0].Description == "" || catalog[0].License != "MIT" ||
		catalog[0].Challenge != "Confidential Document" || catalog[0].JudgeType != "application-oracle" {
		t.Fatalf("unexpected manifest-derived catalog: %#v", catalog)
	}
	if catalog[1].ID != WebGoatPackageID || catalog[1].Version != "v2025.3" ||
		catalog[1].AccessType != "form" ||
		catalog[1].LaunchPath != "/WebGoat/attack#lesson/SqlInjection.lesson" ||
		catalog[1].Challenge != "SqlInjection" {
		t.Fatalf("unexpected WebGoat catalog entry: %#v", catalog[1])
	}
}

func TestComposeContractRejectsPublicOrExternallyConnectedWorkload(t *testing.T) {
	manager, err := newManager(t.TempDir(), &fakeRunner{})
	if err != nil {
		t.Fatal(err)
	}
	installed := manager.packages[JuiceShopPackageID]
	data, err := os.ReadFile(filepath.Join(installed.directory, "compose.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	valid := string(data)
	for name, mutated := range map[string]string{
		"public bind":          strings.Replace(valid, "127.0.0.1:${MILKSU_CTF_PORT", "0.0.0.0:${MILKSU_CTF_PORT", 1),
		"non-internal lab":     strings.Replace(valid, "    internal: true\n", "", 1),
		"unpinned proxy image": strings.Replace(valid, installed.manifest.Metadata.Source.Image+"@"+installed.manifest.Metadata.Source.Digest, installed.manifest.Metadata.Source.Image, 1),
	} {
		t.Run(name, func(t *testing.T) {
			if err := verifyComposeContract(installed.manifest, mutated); err == nil {
				t.Fatal("unsafe compose contract was accepted")
			}
		})
	}
}

func TestManagerRejectsUnknownLabAndInstance(t *testing.T) {
	manager, err := newManager(t.TempDir(), &fakeRunner{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Start(context.Background(), "user.supplied"); err == nil {
		t.Fatal("unknown lab was executed")
	}
	if _, err := manager.Status("missing-instance"); err == nil {
		t.Fatal("unknown instance was returned")
	}
	if _, err := manager.Clean(context.Background(), "missing-instance"); err == nil {
		t.Fatal("unknown instance was cleaned")
	}
}

func TestManagerRejectsCorruptPersistedState(t *testing.T) {
	root := t.TempDir()
	stateDirectory := filepath.Join(root, "labs")
	if err := os.MkdirAll(stateDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stateDirectory, "state.json"), []byte("{broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := newManager(root, &fakeRunner{}); err == nil {
		t.Fatal("corrupt state was silently ignored")
	}
}

func TestLabCommandsDoNotInheritApplicationSecrets(t *testing.T) {
	t.Setenv("MILKSU_TEST_SECRET", "must-not-reach-lab")
	runner := &fakeRunner{}
	manager, err := newManager(t.TempDir(), runner)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Start(context.Background(), JuiceShopPackageID); err != nil {
		t.Fatal(err)
	}
	for _, environment := range runner.environments {
		for _, entry := range environment {
			if strings.HasPrefix(entry, "MILKSU_TEST_SECRET=") {
				t.Fatalf("lab command inherited an unrelated secret: %q", entry)
			}
		}
	}
}

func environmentValue(environment []string, name string) string {
	prefix := name + "="
	for _, entry := range environment {
		if strings.HasPrefix(entry, prefix) {
			return strings.TrimPrefix(entry, prefix)
		}
	}
	return ""
}

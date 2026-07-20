package labmanager

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

type fakeRunner struct {
	commands     []string
	environments [][]string
}

func (r *fakeRunner) Run(_ context.Context, _ string, args, environment []string, _ string) ([]byte, error) {
	r.commands = append(r.commands, strings.Join(args, " "))
	r.environments = append(r.environments, append([]string{}, environment...))
	for _, entry := range environment {
		if strings.HasPrefix(entry, "MILKSU_CTF_PORT=") {
			return []byte("ready " + entry), nil
		}
	}
	return nil, fmt.Errorf("missing managed port")
}

func TestManagerOwnsFixedLabLifecycle(t *testing.T) {
	runner := &fakeRunner{}
	manager, err := newManager(t.TempDir(), runner)
	if err != nil {
		t.Fatal(err)
	}
	state, err := manager.Start(context.Background(), JuiceShopPackageID)
	if err != nil {
		t.Fatal(err)
	}
	if state.Phase != "ready" || !strings.HasPrefix(state.Endpoint, "http://127.0.0.1:") || len(state.Scope.Targets) != 2 {
		t.Fatalf("unexpected managed lab state: %#v", state)
	}
	if _, err := manager.Reset(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	want := []string{"pull", "start", "reset", "stop"}
	if strings.Join(runner.commands, ",") != strings.Join(want, ",") {
		t.Fatalf("unexpected lifecycle commands: %v", runner.commands)
	}
}

func TestManagerRejectsUnknownLab(t *testing.T) {
	manager, err := newManager(t.TempDir(), &fakeRunner{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Start(context.Background(), "user.supplied"); err == nil {
		t.Fatal("unknown lab was executed")
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

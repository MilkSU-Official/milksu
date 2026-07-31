package labmanager

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestRealDockerLifecycleAndContainment(t *testing.T) {
	if os.Getenv("MILKSU_LAB_INTEGRATION") != "1" {
		t.Skip("set MILKSU_LAB_INTEGRATION=1 to run the real Docker lifecycle")
	}
	if _, err := exec.LookPath("docker"); err != nil {
		t.Skip("Docker CLI is unavailable")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
	defer cancel()
	root := t.TempDir()
	manager, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), time.Minute)
		defer cleanupCancel()
		_, _ = manager.Clean(cleanupContext)
	})

	started, err := manager.Start(ctx, JuiceShopPackageID)
	if err != nil {
		t.Fatal(err)
	}
	if started.Phase != "ready" || !strings.HasPrefix(started.Endpoint, "http://127.0.0.1:") {
		t.Fatalf("unexpected real lab state: %#v", started)
	}

	response, err := (&http.Client{Timeout: 5 * time.Second}).Get(started.Endpoint + "/")
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 400 {
		t.Fatalf("unexpected Juice Shop readiness status: %s", response.Status)
	}

	directory := filepath.Join(root, "labs", "ctf", "juice-shop")
	containerID := dockerComposeOutput(t, ctx, directory, "ps", "--quiet", "juice-shop")
	if containerID == "" {
		t.Fatal("real lab did not expose a running container")
	}
	rawInspect := dockerOutput(t, ctx, "inspect", containerID)
	var inspected []struct {
		HostConfig struct {
			Privileged   bool     `json:"Privileged"`
			Binds        []string `json:"Binds"`
			CapDrop      []string `json:"CapDrop"`
			SecurityOpt  []string `json:"SecurityOpt"`
			PortBindings map[string][]struct {
				HostIP   string `json:"HostIp"`
				HostPort string `json:"HostPort"`
			} `json:"PortBindings"`
		} `json:"HostConfig"`
	}
	if err := json.Unmarshal([]byte(rawInspect), &inspected); err != nil {
		t.Fatal(err)
	}
	if len(inspected) != 1 {
		t.Fatalf("unexpected docker inspect result count: %d", len(inspected))
	}
	host := inspected[0].HostConfig
	bindings := host.PortBindings["3000/tcp"]
	if host.Privileged ||
		len(host.Binds) != 0 ||
		!slices.Contains(host.CapDrop, "ALL") ||
		!slices.Contains(host.SecurityOpt, "no-new-privileges:true") ||
		len(bindings) != 1 ||
		bindings[0].HostIP != "127.0.0.1" ||
		bindings[0].HostPort != strings.TrimPrefix(started.Endpoint, "http://127.0.0.1:") {
		t.Fatalf("real container violated the lab containment contract: %#v", host)
	}

	reset, err := manager.Reset(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if reset.Phase != "ready" || reset.Endpoint != started.Endpoint {
		t.Fatalf("real reset lost its endpoint: %#v", reset)
	}
	stopped, err := manager.Stop(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if stopped.Phase != "stopped" {
		t.Fatalf("real stop did not persist: %#v", stopped)
	}
	cleaned, err := manager.Clean(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if cleaned.Phase != "cleaned" || cleaned.Endpoint != "" || cleaned.Port != 0 || len(cleaned.Scope.Targets) != 0 {
		t.Fatalf("real cleanup retained endpoint or scope: %#v", cleaned)
	}
	if remaining := dockerComposeOutput(t, ctx, directory, "ps", "--quiet", "--all"); remaining != "" {
		t.Fatalf("cleanup left a lab container behind: %s", remaining)
	}
}

func dockerComposeOutput(t *testing.T, ctx context.Context, directory string, args ...string) string {
	t.Helper()
	commandArgs := append([]string{
		"compose",
		"--project-name", "milksu-ctf-juice-shop",
		"--file", filepath.Join(directory, "compose.yaml"),
	}, args...)
	return dockerOutput(t, ctx, commandArgs...)
}

func dockerOutput(t *testing.T, ctx context.Context, args ...string) string {
	t.Helper()
	output, err := exec.CommandContext(ctx, "docker", args...).CombinedOutput()
	if err != nil {
		t.Fatalf("docker %s failed: %v\n%s", strings.Join(args, " "), err, output)
	}
	return strings.TrimSpace(string(output))
}

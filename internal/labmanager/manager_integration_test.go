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
		instances := manager.ListInstances()
		for _, instance := range instances {
			_, _ = manager.Clean(cleanupContext, instance.InstanceID)
		}
	})

	started, err := manager.Start(ctx, JuiceShopPackageID)
	if err != nil {
		t.Fatal(err)
	}
	if started.Phase != "ready" || !strings.HasPrefix(started.Endpoint, "http://127.0.0.1:") {
		t.Fatalf("unexpected real lab state: %#v", started)
	}

	response, err := waitForHTTP(ctx, started.Endpoint+"/", 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 400 {
		t.Fatalf("unexpected Juice Shop readiness status: %s", response.Status)
	}

	directory := filepath.Join(root, "labs", "ctf", "juice-shop")
	rawNetwork := dockerOutput(t, ctx, "network", "inspect", started.ProjectName+"_lab")
	var inspectedNetworks []struct {
		Internal bool `json:"Internal"`
	}
	if err := json.Unmarshal([]byte(rawNetwork), &inspectedNetworks); err != nil {
		t.Fatal(err)
	}
	if len(inspectedNetworks) != 1 || !inspectedNetworks[0].Internal {
		t.Fatalf("real lab network is not internally isolated: %s", rawNetwork)
	}
	appContainerID := dockerComposeOutput(t, ctx, directory, started.ProjectName, "ps", "--quiet", "juice-shop")
	proxyContainerID := dockerComposeOutput(t, ctx, directory, started.ProjectName, "ps", "--quiet", "loopback-proxy")
	if appContainerID == "" || proxyContainerID == "" {
		t.Fatal("real lab did not expose its workload and loopback proxy containers")
	}
	type containerInspect struct {
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
		NetworkSettings struct {
			Networks map[string]json.RawMessage `json:"Networks"`
		} `json:"NetworkSettings"`
	}
	inspectContainer := func(containerID string) containerInspect {
		rawInspect := dockerOutput(t, ctx, "inspect", containerID)
		var inspected []containerInspect
		if err := json.Unmarshal([]byte(rawInspect), &inspected); err != nil {
			t.Fatal(err)
		}
		if len(inspected) != 1 {
			t.Fatalf("unexpected docker inspect result count: %d", len(inspected))
		}
		return inspected[0]
	}
	app := inspectContainer(appContainerID)
	proxy := inspectContainer(proxyContainerID)
	if app.HostConfig.Privileged ||
		len(app.HostConfig.Binds) != 0 ||
		!slices.Contains(app.HostConfig.CapDrop, "ALL") ||
		!slices.Contains(app.HostConfig.SecurityOpt, "no-new-privileges:true") ||
		len(app.HostConfig.PortBindings) != 0 ||
		len(app.NetworkSettings.Networks) != 1 ||
		app.NetworkSettings.Networks[started.ProjectName+"_lab"] == nil {
		t.Fatalf("real workload container violated the isolated lab contract: %#v", app)
	}
	bindings := proxy.HostConfig.PortBindings["3001/tcp"]
	if proxy.HostConfig.Privileged ||
		len(proxy.HostConfig.Binds) != 0 ||
		!slices.Contains(proxy.HostConfig.CapDrop, "ALL") ||
		!slices.Contains(proxy.HostConfig.SecurityOpt, "no-new-privileges:true") ||
		len(bindings) != 1 ||
		bindings[0].HostIP != "127.0.0.1" ||
		bindings[0].HostPort != strings.TrimPrefix(started.Endpoint, "http://127.0.0.1:") ||
		len(proxy.NetworkSettings.Networks) != 2 ||
		proxy.NetworkSettings.Networks[started.ProjectName+"_lab"] == nil ||
		proxy.NetworkSettings.Networks[started.ProjectName+"_ingress"] == nil {
		t.Fatalf("real loopback proxy violated the published endpoint contract: %#v", proxy)
	}

	restartedManager, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	orphaned, err := restartedManager.Status(started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if orphaned.Phase != "orphaned" || !orphaned.RecoveryPending {
		t.Fatalf("restarted manager did not quarantine active persisted state: %#v", orphaned)
	}
	if _, err := restartedManager.Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	manager = restartedManager
	recovered, err := manager.Status(started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Phase != "ready" || recovered.RecoveryPending ||
		recovered.Endpoint != started.Endpoint || recovered.ProjectName != started.ProjectName {
		t.Fatalf("real healthy instance was not reconciled after restart: %#v", recovered)
	}
	recoveredResponse, err := waitForHTTP(ctx, recovered.Endpoint+"/", 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_ = recoveredResponse.Body.Close()
	if recoveredResponse.StatusCode < 200 || recoveredResponse.StatusCode >= 400 {
		t.Fatalf("reconciled endpoint is not accessible: %s", recoveredResponse.Status)
	}

	judged, err := manager.Judge(ctx, started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if !judged.Completed || judged.Solved ||
		judged.Reference != started.Endpoint+"/api/Challenges/" ||
		!strings.Contains(judged.Summary, "not solved") {
		t.Fatalf("fresh real lab returned an unexpected judge result: %#v", judged)
	}

	reset, err := manager.Reset(ctx, started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if reset.Phase != "ready" || reset.Endpoint != started.Endpoint {
		t.Fatalf("real reset lost its endpoint: %#v", reset)
	}
	stopped, err := manager.Stop(ctx, started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if stopped.Phase != "stopped" {
		t.Fatalf("real stop did not persist: %#v", stopped)
	}
	cleaned, err := manager.Clean(ctx, started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if cleaned.Phase != "cleaned" || cleaned.Endpoint != "" || cleaned.Port != 0 || len(cleaned.Scope.Targets) != 0 {
		t.Fatalf("real cleanup retained endpoint or scope: %#v", cleaned)
	}
	if remaining := dockerComposeOutput(t, ctx, directory, started.ProjectName, "ps", "--quiet", "--all"); remaining != "" {
		t.Fatalf("cleanup left a lab container behind: %s", remaining)
	}
}

func TestRealWebGoatLifecycleAccessOracleAndRecovery(t *testing.T) {
	if os.Getenv("MILKSU_LAB_INTEGRATION") != "1" {
		t.Skip("set MILKSU_LAB_INTEGRATION=1 to run the real Docker lifecycle")
	}
	if _, err := exec.LookPath("docker"); err != nil {
		t.Skip("Docker CLI is unavailable")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	root := t.TempDir()
	manager, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cleanupCancel()
		for _, instance := range manager.ListInstances() {
			_, _ = manager.Clean(cleanupContext, instance.InstanceID)
		}
	})

	started, err := manager.Start(ctx, WebGoatPackageID)
	if err != nil {
		t.Fatal(err)
	}
	if started.Phase != "ready" || !strings.HasPrefix(started.Endpoint, "http://127.0.0.1:") {
		t.Fatalf("unexpected WebGoat state: %#v", started)
	}
	access, err := manager.Access(started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if access.Username == "" || access.Password == "" ||
		access.LoginURL != started.Endpoint+"/WebGoat/login" {
		t.Fatalf("WebGoat access was not initialized: %#v", access)
	}
	launchURL, err := manager.LaunchURL(started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if launchURL != started.Endpoint+"/WebGoat/attack#lesson/SqlInjection.lesson" {
		t.Fatalf("unexpected guided WebGoat launch URL: %q", launchURL)
	}

	response, err := waitForHTTP(ctx, started.Endpoint+"/WebGoat/actuator/health", 15*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	var health struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(response.Body).Decode(&health); err != nil {
		_ = response.Body.Close()
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK || health.Status != "UP" {
		t.Fatalf("unexpected WebGoat health response: %s %#v", response.Status, health)
	}

	directory := filepath.Join(root, "labs", "ctf", "webgoat")
	rawNetwork := dockerOutput(t, ctx, "network", "inspect", started.ProjectName+"_lab")
	var inspectedNetworks []struct {
		Internal bool `json:"Internal"`
	}
	if err := json.Unmarshal([]byte(rawNetwork), &inspectedNetworks); err != nil {
		t.Fatal(err)
	}
	if len(inspectedNetworks) != 1 || !inspectedNetworks[0].Internal {
		t.Fatalf("WebGoat network is not internally isolated: %s", rawNetwork)
	}
	containerID := dockerComposeOutput(t, ctx, directory, started.ProjectName, "ps", "--quiet", "webgoat")
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
		NetworkSettings struct {
			Networks map[string]json.RawMessage `json:"Networks"`
		} `json:"NetworkSettings"`
	}
	if err := json.Unmarshal([]byte(rawInspect), &inspected); err != nil || len(inspected) != 1 {
		t.Fatalf("inspect WebGoat container: %v %s", err, rawInspect)
	}
	bindings := inspected[0].HostConfig.PortBindings["8080/tcp"]
	if inspected[0].HostConfig.Privileged ||
		len(inspected[0].HostConfig.Binds) != 0 ||
		!slices.Contains(inspected[0].HostConfig.CapDrop, "ALL") ||
		!slices.Contains(inspected[0].HostConfig.SecurityOpt, "no-new-privileges:true") ||
		len(bindings) != 1 ||
		bindings[0].HostIP != "127.0.0.1" ||
		bindings[0].HostPort != strings.TrimPrefix(started.Endpoint, "http://127.0.0.1:") ||
		len(inspected[0].NetworkSettings.Networks) != 1 ||
		inspected[0].NetworkSettings.Networks[started.ProjectName+"_lab"] == nil {
		t.Fatalf("WebGoat container violated the isolated contract: %#v", inspected[0])
	}

	egressCommand := exec.CommandContext(
		ctx,
		"docker", "compose",
		"--project-name", started.ProjectName,
		"--file", filepath.Join(directory, "compose.yaml"),
		"exec", "--no-TTY", "webgoat",
		"curl", "--fail", "--silent", "--connect-timeout", "3", "http://1.1.1.1/",
	)
	if output, err := egressCommand.CombinedOutput(); err == nil {
		t.Fatalf("WebGoat unexpectedly reached the public internet: %s", output)
	}

	judged, err := manager.Judge(ctx, started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if !judged.Completed || judged.Solved || judged.ReceiptSHA256 == "" ||
		!strings.Contains(judged.Summary, "0/9") {
		t.Fatalf("fresh WebGoat returned an invalid oracle receipt: %#v", judged)
	}

	restartedManager, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restartedManager.Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	manager = restartedManager
	recovered, err := manager.Status(started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Phase != "ready" || recovered.RecoveryPending ||
		recovered.Endpoint != started.Endpoint {
		t.Fatalf("WebGoat did not recover after app restart: %#v", recovered)
	}
	if _, err := manager.Access(started.InstanceID); err != nil {
		t.Fatalf("WebGoat private login did not survive recovery: %v", err)
	}

	reset, err := manager.Reset(ctx, started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	resetAccess, err := manager.Access(started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if reset.Phase != "ready" || reset.Endpoint != started.Endpoint ||
		resetAccess.Password == access.Password {
		t.Fatalf("WebGoat reset did not rotate private access: %#v %#v", reset, resetAccess)
	}
	if _, err := manager.Stop(ctx, started.InstanceID); err != nil {
		t.Fatal(err)
	}
	cleaned, err := manager.Clean(ctx, started.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if cleaned.Phase != "cleaned" {
		t.Fatalf("WebGoat cleanup failed: %#v", cleaned)
	}
	if _, err := os.Stat(manager.instanceStateDirectory(started.InstanceID)); !os.IsNotExist(err) {
		t.Fatalf("WebGoat cleanup retained private access state: %v", err)
	}
}

func waitForHTTP(ctx context.Context, endpoint string, timeout time.Duration) (*http.Response, error) {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 2 * time.Second}
	var lastErr error
	for time.Now().Before(deadline) {
		response, err := client.Get(endpoint)
		if err == nil {
			return response, nil
		}
		lastErr = err
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
	return nil, lastErr
}

func dockerComposeOutput(t *testing.T, ctx context.Context, directory, projectName string, args ...string) string {
	t.Helper()
	commandArgs := append([]string{
		"compose",
		"--project-name", projectName,
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

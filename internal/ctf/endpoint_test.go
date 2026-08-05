package ctf

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

func TestDynamicEndpointRequiresRequestThenCreatesOneImmutableScope(t *testing.T) {
	core, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewService(core, ServiceOptions{Engine: &solvingEngine{}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = service.Close()
		_ = core.Close()
	})
	started, err := service.StartChallenge(context.Background(), ChallengeRequest{
		Title:             "Dynamic web endpoint",
		Statement:         "Inspect the endpoint only after user approval.",
		Category:          "web",
		CollaborationMode: "copilot",
		DeferAgent:        true,
		SourceKind:        "text",
	})
	if err != nil {
		t.Fatal(err)
	}
	sourceScopeID := started.Challenge.Source.Scope.ID
	requested, err := service.RequestDynamicEndpoint(
		context.Background(),
		started.Job.ID,
		EndpointRequestInput{
			Protocol: EndpointProtocolHTTPS,
			Endpoint: "https://api.example.test:8443",
			Source:   "题目页面的实例入口",
			Purpose:  "读取本题实例的 HTTP 基线响应",
		},
		EndpointRequesterPage,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(requested.EndpointRequests) != 1 ||
		requested.EndpointRequests[0].Status != EndpointRequestPending ||
		len(requested.NetworkScopes) != 0 ||
		containsString(requested.Challenge.AgentPolicy.AllowedTools, "ctf_http") {
		t.Fatalf("pending request expanded network authority: %+v", requested)
	}
	request := requested.EndpointRequests[0]
	if request.Protocol != EndpointProtocolHTTPS ||
		request.Host != "api.example.test" ||
		request.Port != 8443 ||
		request.Target != (securitypolicy.Target{
			Kind: securitypolicy.TargetOrigin, Value: "https://api.example.test:8443",
		}) ||
		request.RequestedBy != EndpointRequesterPage {
		t.Fatalf("request did not preserve normalized review fields: %+v", request)
	}
	deduplicated, err := service.RequestDynamicEndpoint(
		context.Background(),
		started.Job.ID,
		EndpointRequestInput{
			Protocol: EndpointProtocolHTTPS,
			Endpoint: "https://api.example.test:8443/",
			Source:   "另一次发现",
			Purpose:  "同一目标",
		},
		EndpointRequesterAgent,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(deduplicated.EndpointRequests) != 1 {
		t.Fatalf("same pending target was not deduplicated: %+v", deduplicated.EndpointRequests)
	}
	approved, err := service.DecideDynamicEndpoint(
		context.Background(),
		started.Job.ID,
		request.ID,
		true,
	)
	if err != nil {
		t.Fatal(err)
	}
	if approved.Challenge.Source.Scope.ID != sourceScopeID ||
		len(approved.NetworkScopes) != 1 ||
		len(approved.NetworkScopes[0].Targets) != 1 ||
		approved.NetworkScopes[0].Targets[0] != request.Target ||
		approved.EndpointRequests[0].Status != EndpointRequestApproved ||
		approved.EndpointRequests[0].Scope == nil ||
		!containsString(approved.Challenge.AgentPolicy.AllowedTools, "ctf_http") {
		t.Fatalf("approval did not append one independent immutable scope: %+v", approved)
	}
	if lifetime := approved.NetworkScopes[0].ExpiresAt.Sub(
		approved.NetworkScopes[0].CreatedAt,
	); lifetime != dynamicEndpointScopeTTL {
		t.Fatalf("dynamic Scope lifetime = %s, want %s", lifetime, dynamicEndpointScopeTTL)
	}
	if _, err := service.DecideDynamicEndpoint(
		context.Background(),
		started.Job.ID,
		request.ID,
		false,
	); err == nil || !strings.Contains(err.Error(), "already been decided") {
		t.Fatalf("endpoint decision was mutable: %v", err)
	}
	if _, err := service.RequestDynamicEndpoint(
		context.Background(),
		started.Job.ID,
		EndpointRequestInput{
			Protocol: EndpointProtocolHTTPS,
			Endpoint: "https://api.example.test:8443",
			Source:   "重复目标",
			Purpose:  "再次访问",
		},
		EndpointRequesterUser,
	); err == nil || !strings.Contains(err.Error(), "active user-granted scope") {
		t.Fatalf("active scope did not block redundant reauthorization: %v", err)
	}
}

func TestDynamicEndpointDenialAndProtocolBoundaries(t *testing.T) {
	core, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewService(core, ServiceOptions{Engine: &solvingEngine{}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = service.Close()
		_ = core.Close()
	})
	started, err := service.StartChallenge(context.Background(), ChallengeRequest{
		Title: "Protocol separation", Statement: "Keep TCP and SSH separate.",
		Category: "pwn", CollaborationMode: "delegate", DeferAgent: true,
		SourceKind: "text",
	})
	if err != nil {
		t.Fatal(err)
	}
	tcp, err := service.RequestDynamicEndpoint(context.Background(), started.Job.ID, EndpointRequestInput{
		Protocol: EndpointProtocolTCP,
		Endpoint: "challenge.example.test:31337",
		Source:   "题面给出的 TCP 地址",
		Purpose:  "读取服务 banner",
	}, EndpointRequesterAgent)
	if err != nil {
		t.Fatal(err)
	}
	denied, err := service.DecideDynamicEndpoint(
		context.Background(), started.Job.ID, tcp.EndpointRequests[0].ID, false,
	)
	if err != nil {
		t.Fatal(err)
	}
	if denied.EndpointRequests[0].Status != EndpointRequestDenied ||
		denied.EndpointRequests[0].Scope != nil ||
		len(denied.NetworkScopes) != 0 ||
		containsString(denied.Challenge.AgentPolicy.AllowedTools, "ctf_socket") {
		t.Fatalf("denied request leaked authority: %+v", denied)
	}
	sshRequested, err := service.RequestDynamicEndpoint(context.Background(), started.Job.ID, EndpointRequestInput{
		Protocol: EndpointProtocolSSH,
		Endpoint: "challenge.example.test:22",
		Source:   "题面 SSH 地址",
		Purpose:  "只读探测 SSH 服务标识",
	}, EndpointRequesterUser)
	if err != nil {
		t.Fatal(err)
	}
	sshRequest := sshRequested.EndpointRequests[len(sshRequested.EndpointRequests)-1]
	approved, err := service.DecideDynamicEndpoint(
		context.Background(), started.Job.ID, sshRequest.ID, true,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !containsString(approved.Challenge.AgentPolicy.AllowedTools, "ctf_ssh") ||
		containsString(approved.Challenge.AgentPolicy.AllowedTools, "ctf_socket") {
		t.Fatalf("SSH authorization collapsed into generic TCP: %#v", approved.Challenge.AgentPolicy.AllowedTools)
	}
}

func TestEndpointNormalizationRejectsAmbiguousOrCredentialedTargets(t *testing.T) {
	valid, err := normalizeEndpointRequest(EndpointRequestInput{
		Protocol: EndpointProtocolHTTP,
		Endpoint: "http://[::1]:8080",
		Source:   "本地 fixture",
		Purpose:  "读取安全测试响应",
	}, EndpointRequesterUser)
	if err != nil {
		t.Fatal(err)
	}
	if valid.Host != "::1" || valid.Port != 8080 || valid.Target.Value != "http://[::1]:8080" {
		t.Fatalf("IPv6 endpoint was not normalized exactly: %+v", valid)
	}
	for _, input := range []EndpointRequestInput{
		{Protocol: EndpointProtocolHTTPS, Endpoint: "https://user:secret@example.test", Source: "page", Purpose: "test"},
		{Protocol: EndpointProtocolHTTPS, Endpoint: "https://example.test/path", Source: "page", Purpose: "test"},
		{Protocol: EndpointProtocolHTTPS, Endpoint: "https://example.test/?token=value", Source: "page", Purpose: "test"},
		{Protocol: EndpointProtocolTCP, Endpoint: "example.test", Source: "page", Purpose: "test"},
		{Protocol: EndpointProtocolSSH, Endpoint: "example.test:not-a-port", Source: "page", Purpose: "test"},
		{Protocol: "udp", Endpoint: "example.test:53", Source: "page", Purpose: "test"},
		{Protocol: EndpointProtocolTCP, Endpoint: "example.test:80", Source: "page\ninjected", Purpose: "test"},
	} {
		if _, err := normalizeEndpointRequest(input, EndpointRequesterAgent); err == nil {
			t.Fatalf("unsafe Endpoint was accepted: %+v", input)
		}
	}
}

func TestExpiredDynamicScopeDoesNotEnableAnAgentNetworkTool(t *testing.T) {
	request, err := normalizeEndpointRequest(EndpointRequestInput{
		Protocol: EndpointProtocolHTTPS,
		Endpoint: "https://expired.example.test",
		Source:   "expired fixture",
		Purpose:  "verify expiry",
	}, EndpointRequesterUser)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	request.ID = "endpoint_expired"
	request.RequestedAt = now.Add(-10 * time.Hour)
	grant, err := securitypolicy.NewGrant(
		"ctf-endpoint:"+request.ID,
		request.Purpose,
		[]securitypolicy.Target{request.Target},
		dynamicEndpointScopeTTL,
	)
	if err != nil {
		t.Fatal(err)
	}
	grant.CreatedAt = now.Add(-9 * time.Hour)
	grant.ExpiresAt = now.Add(-time.Hour)
	decidedAt := grant.CreatedAt.Add(time.Minute)
	requestData, _ := json.Marshal(request)
	decisionData, _ := json.Marshal(endpointDecision{
		RequestID: request.ID,
		Status:    EndpointRequestApproved,
		Scope:     &grant,
		DecidedAt: decidedAt,
	})
	requests, scopes, err := projectEndpointAuthorization([]securityruntime.RoleFact{
		{PackageID: PackageID, SchemaVersion: SchemaVersion, Kind: FactEndpointRequested, Data: requestData},
		{PackageID: PackageID, SchemaVersion: SchemaVersion, Kind: FactEndpointDecided, Data: decisionData},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(requests) != 1 || len(scopes) != 1 {
		t.Fatalf("expired authorization history was not projected: requests=%+v scopes=%+v", requests, scopes)
	}
	localScope, err := securitypolicy.NewGrant(
		"test:offline",
		"offline fixture",
		[]securitypolicy.Target{{Kind: securitypolicy.TargetLab, Value: "offline"}},
		time.Hour,
	)
	if err != nil {
		t.Fatal(err)
	}
	policy := agentCollaborationPolicyForChallenge(
		"copilot",
		ChallengeSource{Kind: "text", Scope: localScope},
		scopes,
	)
	if containsString(policy.AllowedTools, "ctf_http") {
		t.Fatalf("expired scope enabled HTTP access: %#v", policy.AllowedTools)
	}

	grant.ExpiresAt = grant.CreatedAt.Add(dynamicEndpointScopeTTL + time.Minute)
	decisionData, _ = json.Marshal(endpointDecision{
		RequestID: request.ID,
		Status:    EndpointRequestApproved,
		Scope:     &grant,
		DecidedAt: decidedAt,
	})
	if _, _, err := projectEndpointAuthorization([]securityruntime.RoleFact{
		{PackageID: PackageID, SchemaVersion: SchemaVersion, Kind: FactEndpointRequested, Data: requestData},
		{PackageID: PackageID, SchemaVersion: SchemaVersion, Kind: FactEndpointDecided, Data: decisionData},
	}); err == nil {
		t.Fatal("a dynamic Endpoint Scope with an extended lifetime was accepted")
	}
}

func TestStaticSSHSourceUsesDedicatedSSHScope(t *testing.T) {
	source, err := validateSource("ssh", "ssh://player@example.test:2222", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(source.Scope.Targets) != 1 ||
		source.Scope.Targets[0] != (securitypolicy.Target{
			Kind: securitypolicy.TargetSSH, Value: "example.test:2222",
		}) {
		t.Fatalf("static SSH source did not preserve protocol scope: %+v", source.Scope.Targets)
	}
}

func TestApprovedEndpointScopeSurvivesRuntimeRestart(t *testing.T) {
	root := t.TempDir()
	firstCore, err := securityruntime.NewService(root, nil)
	if err != nil {
		t.Fatal(err)
	}
	first, err := NewService(firstCore, ServiceOptions{Engine: &solvingEngine{}})
	if err != nil {
		t.Fatal(err)
	}
	started, err := first.StartChallenge(context.Background(), ChallengeRequest{
		Title: "Restart endpoint", Statement: "Persist one explicit decision.",
		Category: "pwn", CollaborationMode: "delegate", DeferAgent: true,
		SourceKind: "text",
	})
	if err != nil {
		t.Fatal(err)
	}
	requested, err := first.RequestDynamicEndpoint(context.Background(), started.Job.ID, EndpointRequestInput{
		Protocol: EndpointProtocolTCP,
		Endpoint: "127.0.0.1:31337",
		Source:   "restart fixture",
		Purpose:  "read one bounded response",
	}, EndpointRequesterUser)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := first.DecideDynamicEndpoint(
		context.Background(),
		started.Job.ID,
		requested.EndpointRequests[0].ID,
		true,
	); err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	if err := firstCore.Close(); err != nil {
		t.Fatal(err)
	}

	secondCore, err := securityruntime.NewService(root, nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewService(secondCore, ServiceOptions{Engine: &solvingEngine{}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = second.Close()
		_ = secondCore.Close()
	})
	restarted, err := second.GetJob(context.Background(), started.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(restarted.EndpointRequests) != 1 ||
		restarted.EndpointRequests[0].Status != EndpointRequestApproved ||
		len(restarted.NetworkScopes) != 1 ||
		!containsString(restarted.Challenge.AgentPolicy.AllowedTools, "ctf_socket") {
		t.Fatalf("restart lost the endpoint decision or exact tool policy: %+v", restarted)
	}
	handoff, err := PrepareAgentWorkspace(
		context.Background(),
		t.TempDir(),
		restarted,
		secondCore,
	)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadAgentWorkspaceHandoff(handoff.WorkspacePath)
	if err != nil {
		t.Fatal(err)
	}
	if !containsString(loaded.Policy.AllowedTools, "ctf_socket") {
		t.Fatalf("restarted workspace did not load the approved exact broker: %+v", loaded.Policy)
	}
}

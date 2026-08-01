package securityruntime

import (
	"strings"
	"testing"
)

func TestLabPackageV1Alpha1AcceptsSafePinnedPackage(t *testing.T) {
	packageValue := safeLabPackage()
	if err := packageValue.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestLabPackageV1Alpha1RejectsUnsafeRuntimeAccess(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*LabPackage)
	}{
		{"privileged", func(value *LabPackage) { value.Spec.Security.Privileged = true }},
		{"host network", func(value *LabPackage) { value.Spec.Security.HostNetwork = true }},
		{"docker socket", func(value *LabPackage) { value.Spec.Security.DockerSocket = true }},
		{"host mount", func(value *LabPackage) { value.Spec.Security.HostMounts = []string{"/Users:/host"} }},
		{"public port", func(value *LabPackage) { value.Spec.Runtime.Endpoints[0].Publish = "all-interfaces" }},
		{"egress", func(value *LabPackage) { value.Spec.Runtime.Network.Egress = "allow" }},
		{"entry traversal", func(value *LabPackage) { value.Spec.Runtime.Entry = "../compose.yaml" }},
		{"unknown readiness endpoint", func(value *LabPackage) { value.Spec.Readiness[0].Endpoint = "admin" }},
		{"unsafe launch path", func(value *LabPackage) { value.Spec.Runtime.Endpoints[0].LaunchPath = "/../admin" }},
		{"partial access", func(value *LabPackage) { value.Spec.Access.LoginPath = "/login" }},
		{"unknown oracle response", func(value *LabPackage) {
			value.Spec.Judge.Type = "application-oracle"
			value.Spec.Judge.Challenge = "Lesson"
			value.Spec.Judge.Endpoint = "/api/progress"
			value.Spec.Judge.ResponseContract = "trust-agent-text"
		}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			value := safeLabPackage()
			test.mutate(&value)
			if err := value.Validate(); err == nil {
				t.Fatal("unsafe lab package was accepted")
			}
		})
	}
}

func TestLabPackageAcceptsPinnedFormAccessAssignmentOracle(t *testing.T) {
	value := safeLabPackage()
	value.Spec.Runtime.Endpoints[0].LaunchPath = "/WebGoat/attack#lesson/SqlInjection.lesson"
	value.Spec.Access = LabAccessSpec{
		Type: "form", LoginPath: "/WebGoat/login", StateFile: "access.json",
	}
	value.Spec.Judge = LabJudgeSpec{
		Type:                "application-oracle",
		Challenge:           "SqlInjection",
		Endpoint:            "/WebGoat/service/lessonoverview.mvc/SqlInjection.lesson",
		ResponseContract:    "json-assignment-set",
		ExpectedAssignments: []string{"SqlInjectionLesson2", "SqlInjectionLesson3"},
	}
	if err := value.Validate(); err != nil {
		t.Fatal(err)
	}

	value.Spec.Judge.ExpectedAssignments = append(
		value.Spec.Judge.ExpectedAssignments,
		"SqlInjectionLesson2",
	)
	if err := value.Validate(); err == nil {
		t.Fatal("duplicate assignment contract was accepted")
	}
}

func TestParseLabPackageStrictlyRejectsUnknownFieldsAndTrailingDocuments(t *testing.T) {
	valid := strictPackageYAML()
	parsed, err := ParseLabPackage([]byte(valid))
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Metadata.ID != "test.lab" || parsed.Metadata.Source.Image != "example/test:1" {
		t.Fatalf("unexpected parsed package: %#v", parsed)
	}

	for name, input := range map[string]string{
		"unknown field":        strings.Replace(valid, "  license: MIT", "  license: MIT\n  typo: unsafe", 1),
		"trailing document":    valid + "\n---\nkind: Other\n",
		"contract mismatch":    strings.Replace(valid, "loopback-ephemeral", "all-interfaces", 1),
		"missing image pin":    strings.Replace(valid, "    image: example/test:1\n", "", 1),
		"judge endpoint query": strings.Replace(valid, "    endpoint: /api/challenges", "    endpoint: /api/challenges?all=true", 1),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := ParseLabPackage([]byte(input)); err == nil {
				t.Fatal("invalid lab package YAML was accepted")
			}
		})
	}
}

func safeLabPackage() LabPackage {
	return LabPackage{
		APIVersion: LabPackageAPIVersion,
		Kind:       "LabPackage",
		Metadata: LabMetadata{
			ID: "test.lab", Title: "Test Lab", Version: "1", License: "MIT",
			Source: LabSource{
				URL: "https://example.invalid/lab", Revision: "abc123", Image: "example/test:1",
				Digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			},
		},
		Spec: LabPackageSpec{
			Role: "ctf", Categories: []string{"web"},
			Learning: LabLearningSpec{Objectives: []string{"Learn one bounded thing."}},
			Runtime: LabRuntimeSpec{
				Provider: "compose", Entry: "compose.yaml", Platforms: []string{"linux/arm64"},
				Endpoints: []LabEndpointSpec{{
					Name: "web", Service: "app", TargetPort: 3000, Protocol: "http", Publish: "loopback-ephemeral",
				}},
				Network: LabNetworkSpec{Ingress: "loopback", Egress: "deny"},
			},
			Readiness: []LabReadinessSpec{{Type: "http", Endpoint: "web", Path: "/", Timeout: "30s"}},
			Reset:     LabResetSpec{Strategy: "recreate-with-volumes"},
			Judge:     LabJudgeSpec{Type: "flag", Ref: "judge/flag.json"},
			Security:  LabSecuritySpec{},
		},
	}
}

func strictPackageYAML() string {
	return `apiVersion: labs.milksu.dev/v1alpha1
kind: LabPackage
metadata:
  id: test.lab
  title: Test Lab
  version: "1"
  license: MIT
  source:
    url: https://example.invalid/lab
    revision: abc123
    image: example/test:1
    digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
spec:
  role: ctf
  categories: [web]
  learning:
    objectives: [Learn one bounded thing.]
  runtime:
    provider: compose
    entry: compose.yaml
    platforms: [linux/amd64]
    endpoints:
      - name: web
        service: app
        targetPort: 3000
        protocol: http
        publish: loopback-ephemeral
    network:
      ingress: loopback
      egress: deny
  readiness:
    - type: http
      endpoint: web
      path: /
      timeout: 30s
  reset:
    strategy: recreate-with-volumes
  judge:
    type: application-oracle
    challenge: Example
    endpoint: /api/challenges
  security:
    privileged: false
    hostNetwork: false
    dockerSocket: false
    hostMounts: []
`
}

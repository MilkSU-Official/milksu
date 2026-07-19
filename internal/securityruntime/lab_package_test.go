package securityruntime

import "testing"

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

func safeLabPackage() LabPackage {
	return LabPackage{
		APIVersion: LabPackageAPIVersion,
		Kind:       "LabPackage",
		Metadata: LabMetadata{
			ID: "test.lab", Title: "Test Lab", Version: "1", License: "MIT",
			Source: LabSource{URL: "https://example.invalid/lab", Revision: "abc123", Digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
		},
		Spec: LabPackageSpec{
			Role: "ctf", Categories: []string{"web"},
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

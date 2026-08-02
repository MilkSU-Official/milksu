package securitypolicy

import (
	"path/filepath"
	"testing"
	"time"
)

func TestScopeGrantNormalizesOriginAndEnforcesApproval(t *testing.T) {
	grant, err := NewGrant("user:url", "ctf training", []Target{{Kind: TargetOrigin, Value: "https://ctf.example:443/challenges/1"}}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	read := Decide(grant, EffectRequest{Class: "read_remote", Target: Target{Kind: TargetOrigin, Value: "https://ctf.example:443/other"}}, time.Now())
	if !read.Allowed {
		t.Fatalf("same-origin read was denied: %#v", read)
	}
	submit := Decide(grant, EffectRequest{Class: "submit", Target: Target{Kind: TargetOrigin, Value: "https://ctf.example:443"}}, time.Now())
	if submit.Allowed || !submit.RequiresApproval {
		t.Fatalf("unapproved submission was not gated: %#v", submit)
	}
	approved := Decide(grant, EffectRequest{Class: "submit", Target: Target{Kind: TargetOrigin, Value: "https://ctf.example:443"}, Approved: true}, time.Now())
	if !approved.Allowed {
		t.Fatalf("approved in-scope submission was denied: %#v", approved)
	}
}

func TestOriginScopeCanonicalizesHostAndDefaultPort(t *testing.T) {
	for _, fixture := range []struct {
		input string
		want  string
	}{
		{input: "https://Challenge.Example:443/path", want: "https://challenge.example"},
		{input: "http://Challenge.Example:80/path", want: "http://challenge.example"},
		{input: "https://Challenge.Example:8443/path", want: "https://challenge.example:8443"},
		{input: "http://[::1]:80/path", want: "http://[::1]"},
	} {
		target, err := NormalizeTarget(Target{Kind: TargetOrigin, Value: fixture.input})
		if err != nil {
			t.Fatal(err)
		}
		if target.Value != fixture.want {
			t.Fatalf("NormalizeTarget(%q) = %q, want %q", fixture.input, target.Value, fixture.want)
		}
	}
}

func TestScopeGrantDeniesExpansionAndExpiredGrant(t *testing.T) {
	grant, err := NewGrant("user:url", "ctf", []Target{{Kind: TargetOrigin, Value: "https://one.example"}}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	decision := Decide(grant, EffectRequest{Class: "read_remote", Target: Target{Kind: TargetOrigin, Value: "https://two.example"}}, time.Now())
	if decision.Allowed {
		t.Fatal("cross-origin scope expansion was allowed")
	}
	decision = Decide(grant, EffectRequest{Class: "read_remote", Target: Target{Kind: TargetOrigin, Value: "https://one.example"}}, grant.ExpiresAt.Add(time.Second))
	if decision.Allowed {
		t.Fatal("expired scope was allowed")
	}
}

func TestDirectoryScopeDoesNotEscapeSelectedTree(t *testing.T) {
	root := filepath.Join(t.TempDir(), "selected")
	grant, err := NewGrant("user:directory-picker", "vulnerability research", []Target{{Kind: TargetDirectory, Value: root}}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	inside := Decide(grant, EffectRequest{Class: "read_local", Target: Target{Kind: TargetDirectory, Value: filepath.Join(root, "src")}}, time.Now())
	if !inside.Allowed {
		t.Fatal("path inside selected directory was denied")
	}
	outside := Decide(grant, EffectRequest{Class: "read_local", Target: Target{Kind: TargetDirectory, Value: filepath.Dir(root)}}, time.Now())
	if outside.Allowed {
		t.Fatal("parent directory was allowed")
	}
}

func TestSocketAndSSHScopesRemainProtocolSeparated(t *testing.T) {
	socket, err := NormalizeTarget(Target{Kind: TargetSocket, Value: "challenge.example:31337"})
	if err != nil {
		t.Fatal(err)
	}
	ssh, err := NormalizeTarget(Target{Kind: TargetSSH, Value: "challenge.example:22"})
	if err != nil {
		t.Fatal(err)
	}
	if socket.Kind != TargetSocket || ssh.Kind != TargetSSH {
		t.Fatalf("protocol-specific targets collapsed: socket=%#v ssh=%#v", socket, ssh)
	}
	grant, err := NewGrant("ctf-endpoint:test", "read SSH banner", []Target{ssh}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if decision := Decide(grant, EffectRequest{
		Class:  "limited_interaction",
		Target: Target{Kind: TargetSocket, Value: ssh.Value},
	}, time.Now()); decision.Allowed {
		t.Fatalf("SSH grant authorized a generic TCP request: %#v", decision)
	}
	for _, value := range []string{
		"challenge.example:not-a-port",
		"challenge.example:0",
		"challenge.example:65536",
	} {
		if _, err := NormalizeTarget(Target{Kind: TargetSSH, Value: value}); err == nil {
			t.Fatalf("invalid SSH target %q was accepted", value)
		}
	}
}

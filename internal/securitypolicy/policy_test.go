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

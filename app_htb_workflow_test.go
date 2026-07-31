package main

import (
	"testing"

	"github.com/MilkSU-Official/milksu/internal/htb"
	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
)

func TestHTBChallengeSourceAdmitsOnlyReturnedInstanceTargets(t *testing.T) {
	kind, uri, targets, err := htbChallengeSource(&htb.Container{
		ChallengeID: 901,
		Status:      "running",
		URL:         "https://warmup.example.test/path",
	})
	if err != nil {
		t.Fatal(err)
	}
	if kind != "url" || uri != "https://warmup.example.test/path" ||
		len(targets) != 1 ||
		targets[0].Kind != securitypolicy.TargetOrigin ||
		targets[0].Value != uri {
		t.Fatalf("unexpected HTB URL scope: %s %s %#v", kind, uri, targets)
	}

	kind, uri, targets, err = htbChallengeSource(&htb.Container{
		ChallengeID: 902,
		Status:      "running",
		Host:        "10.10.10.10",
		Port:        31337,
	})
	if err != nil {
		t.Fatal(err)
	}
	if kind != "socket" || uri != "10.10.10.10:31337" ||
		len(targets) != 1 ||
		targets[0].Kind != securitypolicy.TargetSocket {
		t.Fatalf("unexpected HTB socket scope: %s %s %#v", kind, uri, targets)
	}
}

func TestHTBChallengeSourceWithoutContainerStaysLocal(t *testing.T) {
	kind, uri, targets, err := htbChallengeSource(nil)
	if err != nil {
		t.Fatal(err)
	}
	if kind != "url" || uri != "https://ctf.hackthebox.com/" || len(targets) != 0 {
		t.Fatalf("unexpected attachment-only HTB source: %s %s %#v", kind, uri, targets)
	}
}

func TestNormalizeHTBCategory(t *testing.T) {
	cases := map[string]string{
		"1":                   "web",
		"Binary Exploitation": "pwn",
		"Cryptography":        "crypto",
		"Reversing":           "reverse",
		"Forensics":           "forensics",
		"Warmup":              "misc",
	}
	for input, expected := range cases {
		if actual := normalizeHTBCategory(input); actual != expected {
			t.Fatalf("normalizeHTBCategory(%q) = %q, want %q", input, actual, expected)
		}
	}
}

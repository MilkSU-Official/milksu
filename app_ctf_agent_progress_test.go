package main

import (
	"os"
	"strings"
	"testing"
)

func TestCTFWorkspaceShowsMachineOwnedCurrentRouteAndReplanEntry(t *testing.T) {
	data, err := os.ReadFile("app/src/components-vue/CTFPage.vue")
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	for _, expected := range []string{
		"当前路线",
		"agentProgress.lastVerifiedFact",
		"agentProgress.currentHypothesis",
		"agentProgress.nextAction",
		"agentProgress?.needsReplan",
		"策略复盘",
		"prepare_ctf_strategist_workspace",
	} {
		if !strings.Contains(source, expected) {
			t.Fatalf("CTF workspace does not expose %q", expected)
		}
	}
}

func TestCTFAgentProgressContractIsAvailableToTheFrontend(t *testing.T) {
	data, err := os.ReadFile("app/src/ctfTypes.ts")
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	for _, expected := range []string{
		"export interface CTFAgentProgress",
		"lastVerifiedFact?: string",
		"currentHypothesis?: string",
		"nextAction?: string",
		"needsReplan: boolean",
		"recommendedRole:",
		"progress?: CTFAgentProgress",
	} {
		if !strings.Contains(source, expected) {
			t.Fatalf("frontend progress contract does not expose %q", expected)
		}
	}
}

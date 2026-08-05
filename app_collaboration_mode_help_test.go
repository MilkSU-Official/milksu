package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestChallengeDeskExplainsTheRealCollaborationContracts(t *testing.T) {
	repositoryRoot, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	componentPath := filepath.Join(
		repositoryRoot,
		"app",
		"src",
		"components-vue",
		"CTFCollaborationModePicker.vue",
	)
	data, err := os.ReadFile(componentPath)
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	for _, fragment := range []string{
		"查看三种协作模式的区别",
		"你主导解题",
		"不使用 Shell",
		"你和 Agent 一起解",
		"可用受限 Shell",
		"Agent 主导推进",
		"向平台提交候选仍由你确认",
		"Accepted 只认 Judge 回执",
		"@click=\"helpOpen = !helpOpen\"",
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("collaboration help does not expose %q", fragment)
		}
	}
}

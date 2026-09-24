package companion

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestKeepMemoryItemDropsFragments(t *testing.T) {
	item := MemoryCommit{Title: "今天", Markdown: "在改设置", Evidence: "改一下"}
	judge := func(context.Context, any, string) (float64, error) { return 0.1, nil }
	if keepMemoryItem(context.Background(), judge, "改一下", item) {
		t.Fatal("fragment should be dropped")
	}
	judge = func(context.Context, any, string) (float64, error) { return 0.9, nil }
	if !keepMemoryItem(context.Background(), judge, "改一下", item) {
		t.Fatal("durable fact should be kept")
	}
	judge = func(context.Context, any, string) (float64, error) { return 0, errors.New("down") }
	if keepMemoryItem(context.Background(), judge, "改一下", item) {
		t.Fatal("a failed judge should not keep the item")
	}
	if !keepMemoryItem(context.Background(), nil, "改一下", item) {
		t.Fatal("no judge should keep the item until a fallback exists")
	}
}

func TestShouldSpeakFollowsEventKind(t *testing.T) {
	judge := func(context.Context, any, string) (float64, error) { return 0.2, nil }
	if !shouldSpeak(context.Background(), judge, "登录", "settled", "查一下") {
		t.Fatal("settled should speak without asking")
	}
	if !shouldSpeak(context.Background(), nil, "登录", "needs_approval", "查一下") {
		t.Fatal("approval should speak")
	}
	if !shouldSpeak(context.Background(), nil, "登录", "error", "查一下") {
		t.Fatal("a stopped error should speak")
	}
	if shouldSpeak(context.Background(), judge, "登录", "stall", "查一下") {
		t.Fatal("low stall probability should stay quiet")
	}
	if shouldSpeak(context.Background(), nil, "登录", "stall", "查一下") {
		t.Fatal("stall without a judge should stay quiet")
	}
	down := func(context.Context, any, string) (float64, error) { return 0, errors.New("down") }
	if shouldSpeak(context.Background(), down, "登录", "stall", "查一下") {
		t.Fatal("a failed stall judge should stay quiet")
	}
}

func TestQueuedNoticesMergeWhileSpeaking(t *testing.T) {
	runtime := &Runtime{}
	runtime.setInFlight(true)
	runtime.queueNotice(hostNoticePrompt("甲", "settled", "zh"))
	runtime.queueNotice(hostNoticePrompt("乙", "error", "zh"))
	if !strings.Contains(runtime.pendingNotice, "甲") || !strings.Contains(runtime.pendingNotice, "乙") {
		t.Fatalf("in-flight notices were overwritten: %q", runtime.pendingNotice)
	}
}

func TestHostNoticesMergeIntoOne(t *testing.T) {
	first := hostNoticePrompt("登录修复", "settled", "zh")
	second := hostNoticePrompt("依赖升级", "needs_approval", "zh")
	merged := mergeHostNotice(first, second)
	if !strings.Contains(merged, "登录修复") || !strings.Contains(merged, "依赖升级") {
		t.Fatal("both titles should stay in one notice")
	}
	if strings.Count(merged, hostNoticePrefix) != 1 {
		t.Fatal("merged notice should keep a single marker")
	}
	again := mergeHostNotice(merged, second)
	if again != merged {
		t.Fatal("the same title and kind should not be appended twice")
	}
}

func TestHostNoticeTextIsRecognized(t *testing.T) {
	text := hostNoticePrompt("登录修复", "settled", "zh")
	if !isHostNoticeText(text) {
		t.Fatal("notice prompt should be hidden as a user line")
	}
	if isHostNoticeText("帮我看一下登录") {
		t.Fatal("a real user line should stay visible")
	}
}

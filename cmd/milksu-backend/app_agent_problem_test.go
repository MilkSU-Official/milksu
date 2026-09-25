package main

import (
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/conversation"
)

// 读者实测的诉求：被拦过的状态**重启后仍要显示**（横幅 + 侧栏红叉），直到读者点「知道了」
// 或该对话开新一回合。这里钉住落盘、静默跳过、清除（含命令）三条行为，外加两处**接线**。
func newAgentProblemApp(t *testing.T) *App {
	t.Helper()
	store, err := conversation.NewStore()
	if err != nil {
		t.Skipf("conversation store unavailable in this environment: %v", err)
	}
	return &App{conversations: store}
}

func seedProblemConversation(t *testing.T, app *App, id string) {
	t.Helper()
	if err := app.conversations.Save(conversation.StoredConversation{
		ID:        id,
		Title:     "example",
		CreatedAt: uint64(time.Now().UnixMilli()),
	}); err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
}

func readAgentProblem(t *testing.T, app *App, id string) *conversation.StoredAgentProblem {
	t.Helper()
	value, err := app.conversations.Get(id)
	if err != nil {
		t.Fatalf("get conversation: %v", err)
	}
	return value.AgentProblem
}

func TestGuardAlarmIsPersistedOnTheConversation(t *testing.T) {
	app := newAgentProblemApp(t)
	seedProblemConversation(t, app, "conversation-probe")

	app.rememberAgentProblem("conversation-probe", "已拦截：…", "Blocked: …")

	problem := readAgentProblem(t, app, "conversation-probe")
	if problem == nil {
		t.Fatal("the guard alarm must be written onto the conversation record")
	}
	if problem.Notice != "已拦截：…" || problem.NoticeEnglish != "Blocked: …" {
		t.Fatalf("both sentences must survive: %+v", problem)
	}
	if problem.At == 0 {
		t.Fatal("the record must carry when it happened")
	}
}

func TestUnknownConversationIsSkippedQuietly(t *testing.T) {
	app := newAgentProblemApp(t)
	// 没有这条对话记录时不许 panic，也不许凭空造记录。
	app.rememberAgentProblem("conversation-never-saved", "已拦截：…", "Blocked: …")
	if _, err := app.conversations.Get("conversation-never-saved"); err == nil {
		t.Fatal("a missing conversation must not be created just to hold the alarm")
	}
}

func TestForgetAgentProblemClearsTheRecord(t *testing.T) {
	app := newAgentProblemApp(t)
	seedProblemConversation(t, app, "conversation-probe")
	app.rememberAgentProblem("conversation-probe", "已拦截：…", "Blocked: …")

	// 开新一回合（引擎收到 assistant.started）与读者点「知道了」走同一条清除。
	app.forgetAgentProblem("conversation-probe")
	if problem := readAgentProblem(t, app, "conversation-probe"); problem != nil {
		t.Fatalf("the record must be cleared: %+v", problem)
	}

	// 清除命令也必须真的落到记录上（不是只在内存里清）。
	app.rememberAgentProblem("conversation-probe", "已拦截：…", "Blocked: …")
	if err := app.ClearConversationProblem("conversation-probe"); err != nil {
		t.Fatalf("clear command: %v", err)
	}
	if problem := readAgentProblem(t, app, "conversation-probe"); problem != nil {
		t.Fatalf("ClearConversationProblem must clear the record: %+v", problem)
	}
}

// 上面几条测助手本身；这条钉**接线**：少了它，落盘/清除根本不会被调用（只测助手是假绿 ✗）。
// ⚠️ 必须行首锚定：被注释成 `// a.rememberAgentProblem(…)` 的行里仍含该子串，用 Contains 会假绿 ✗。
func TestGuardAlarmWiringIsPinnedInSource(t *testing.T) {
	source, err := os.ReadFile("app.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)

	guardIndex := strings.Index(text, `event.Type == "guard.alarm"`)
	if guardIndex < 0 {
		t.Fatal("guard.alarm 分支不见了（结构变了就更新这条测试）")
	}
	guardBranch := text[guardIndex:]
	if end := strings.Index(guardBranch, "\n\t} else if"); end > 0 {
		guardBranch = guardBranch[:end]
	}
	if !regexp.MustCompile(`(?m)^\s*a\.rememberAgentProblem\(event\.SessionID, event\.Notice, event\.NoticeEnglish\)`).MatchString(guardBranch) {
		t.Fatal("guard.alarm 分支必须把告警落盘（少了这一行，重启后横幅与红叉都会消失）")
	}

	startedIndex := strings.Index(text, `event.Type == "assistant.started"`)
	if startedIndex < 0 {
		t.Fatal("assistant.started 分支不见了（开新回合要清掉记录）")
	}
	startedBranch := text[startedIndex:]
	if end := strings.Index(startedBranch, "\n\t} else if"); end > 0 {
		startedBranch = startedBranch[:end]
	}
	if !regexp.MustCompile(`(?m)^\s*a\.forgetAgentProblem\(event\.SessionID\)`).MatchString(startedBranch) {
		t.Fatal("assistant.started 必须清掉记录（读者口径：开新一回合就消）")
	}
}

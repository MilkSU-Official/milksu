package engine

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// 侧车发出去的事件名，引擎**必须**在改名表里认领 ✗→✓。
//
// 为什么值得一条专门的测试：今天一连查出好几个“静默丢”的毛病，形状完全一样 ——
// 侧车把事件发出去了 ✓，引擎的改名表里**没有**这一条 ✗ ⇒ 它落到 default 变成
// `engine.raw.<name>` ✗ ⇒ 渲染层没有对应分支 ⇒ 读者看到的是“什么都没有”
// （真事：后台任务状态不显示 ✗、模型来源失败不吭声 ✗、模型调用失败（429）整条丢掉 ✗）。
//
// 这条测试把那一整类钉死：新增任何侧车事件名，忘记在引擎认领就会红 ✓。
func TestEverySidecarEventNameIsClaimedByTheEngine(t *testing.T) {
	repositoryRoot := filepath.Join("..", "..")

	// 允许原样透传（引擎故意不认领、也不给渲染层用）——写在这里就必须写清理由 ✓。
	// 这几条都是**不承载“用户可见状态”**的：它们被发出来之后没有人接，也不会让读者
	// 少看到任何东西（真事核查：渲染层 0 处、Go 里 0 处；workspace_action 的响应另有
	// `workspace_action_response` 在消费 ✓）⇒ 不是静默丢弃 ✓。
	// 新增事件请**不要**往这里加：要么在引擎认领，要么在渲染层处理 ✓。
	allowList := map[string]string{
		"agent.delivery_timeout":  "投递超时会由工具自己回给模型，读者不会少看到东西 ✓",
		"background.wake":         "后台唤醒的提示信息，目前无消费方 ✓",
		"thinking_level_selected": "思考档位由渲染层本地状态维护，事件仅作回显 ✓",
		"workspace_action":        "其响应由 workspace_action_response 消费 ✓",
	}

	emitted := map[string]string{} // 事件名 → 首次出现的文件
	entries, err := os.ReadDir(filepath.Join(repositoryRoot, "sidecar", "pi"))
	if err != nil {
		t.Fatalf("read sidecar directory: %v", err)
	}
	emitPattern := regexp.MustCompile(`emit\(\s*[A-Za-z0-9_$.]+\s*,\s*"([a-z0-9_.]+)"`)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".js") {
			continue
		}
		if strings.HasSuffix(entry.Name(), ".test.js") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(repositoryRoot, "sidecar", "pi", entry.Name()))
		if err != nil {
			t.Fatalf("read %s: %v", entry.Name(), err)
		}
		for _, match := range emitPattern.FindAllStringSubmatch(string(raw), -1) {
			name := match[1]
			if _, seen := emitted[name]; !seen {
				emitted[name] = entry.Name()
			}
		}
	}
	if len(emitted) == 0 {
		t.Fatal("no sidecar event names were found: the scan is broken, not the engine")
	}

	source, err := os.ReadFile(filepath.Join("supervisor.go"))
	if err != nil {
		t.Fatalf("read supervisor.go: %v", err)
	}
	casePattern := regexp.MustCompile(`case "([a-z0-9_.]+)":`)
	claimed := map[string]bool{}
	for _, match := range casePattern.FindAllStringSubmatch(string(source), -1) {
		claimed[match[1]] = true
	}

	// 引擎可以直接透传“已经是最终名”的事件（侧车对这类用点号命名，如 agent.delivery）✓，
	// 这类名字只要**渲染层认**就行 ⇒ 判据是“两个名字表里至少有一个认领”✓。
	rendererSource, err := os.ReadFile(filepath.Join(repositoryRoot, "app", "src", "composables", "useConversations.ts"))
	if err != nil {
		t.Fatalf("read the renderer's event handling: %v", err)
	}
	rendererPattern := regexp.MustCompile(`type === '([a-z0-9_.]+)'`)
	rendererKnows := map[string]bool{}
	for _, match := range rendererPattern.FindAllStringSubmatch(string(rendererSource), -1) {
		rendererKnows[match[1]] = true
	}

	var missing []string
	for name, file := range emitted {
		if claimed[name] || rendererKnows[name] || allowList[name] != "" {
			continue
		}
		missing = append(missing, name+" (emitted by "+file+")")
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Fatalf(
			"neither the engine's rename table nor the renderer knows these sidecar events, so "+
				"they are dropped silently:\n  %s",
			strings.Join(missing, "\n  "),
		)
	}
}

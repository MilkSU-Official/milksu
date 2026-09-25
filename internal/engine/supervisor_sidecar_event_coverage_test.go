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
		// 引擎**故意改名**成 `runtime.background_tasks`（渲染层认的也是新名 ✓），
		// 渲染层多认一个旧名只是容错 ⇒ 不是“渲染层认了、引擎却改名”那种漏 ✓。
		"background_tasks": "引擎改名为 runtime.background_tasks，渲染层两个名字都认（故意容错）✓",
		// 属「模型来源提示」那条线：装机线上由引擎改名成 `session.model_source_unavailable`、
		// 渲染层认新名 ✓。本 PR 只收受限文件夹线 ⇒ 这里**只放行这一个名字** ✗，
		// 不许顺手把别的名字塞进来 ✗。
		"model_source_unavailable": "属模型来源提示线，不在本 PR 范围（本 PR 只收受限文件夹线）✓",
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
	// ⚠️ 行首锚定：被注释成 `// case "x":` 的那行**仍然含** `case "x":` 子串 ⇒ 不锚定就会把
	// "注掉认领"误判成"还认领着" ✗（实测：正是这么假绿过一次 ✗）。
	casePattern := regexp.MustCompile(`(?m)^\s*case\s+([^:]+):`)
	labelPattern := regexp.MustCompile(`"([a-z0-9_.]+)"`)
	claimed := map[string]bool{}
	// 引擎“保住原名”的名字：case 体里写的是同名映射（`event.Type = "x"`）或原样透传
	// （`event.Type = raw.Type`）。只有这两种，渲染层才真的能按原名分支到 ✓。
	keptVerbatim := map[string]bool{}
	sourceText := string(source)
	// 引擎在 `switch` **之前**就用显式类型判断处理过的名字（例如 `if raw.Type == "user_memory_turn"`），
	// 也是**真实处理** ✓ —— 事件不会被丢，只是不在这张大小写表里。机械以前只扫 `case` 标签 ⇒
	// 把这种真处理误报成"静默丢弃" ✗（实测：`user_memory_turn` 正是这种）。这里只放这一种形状 ✗。
	handledBeforeSwitch := map[string]bool{}
	for _, match := range regexp.MustCompile(`raw\.Type\s*==\s*"([a-z0-9_.]+)"`).FindAllStringSubmatch(sourceText, -1) {
		handledBeforeSwitch[match[1]] = true
	}
	matches := casePattern.FindAllStringSubmatchIndex(sourceText, -1)
	for _, match := range matches {
		labels := labelPattern.FindAllStringSubmatch(sourceText[match[2]:match[3]], -1)
		end := len(sourceText)
		if next := casePattern.FindStringIndex(sourceText[match[1]:]); next != nil {
			end = match[1] + next[0]
		}
		body := sourceText[match[1]:end]
		for _, label := range labels {
			name := label[1]
			claimed[name] = true
			if strings.Contains(body, "event.Type = \""+name+"\"") ||
				strings.Contains(body, "event.Type = raw.Type") {
				keptVerbatim[name] = true
			}
		}
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
		if claimed[name] || handledBeforeSwitch[name] || rendererKnows[name] || allowList[name] != "" {
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

	// 渲染层认识的名字，引擎**必须原样保住**。
	//
	// 以前的判据是「引擎表或渲染层，认一个就行」✗：渲染层认了、引擎却把它改成了
	// `engine.raw.<name>`，测试照样绿 —— 于是 `guard.alarm`（受保护路径被拦、思考复读）
	// 就这么溜过去了，读者在拦截之后一条提示都看不到（真事：只剩「这一轮没有可见正文」）。
	// 现在改名也算丢 ✗。
	// 渲染层认识的名字里，**侧车也发过**的那些，引擎必须原样保住。
	//
	// 以前的判据是「引擎表或渲染层，认一个就行」✗：渲染层认了、引擎却把它改成了
	// `engine.raw.<name>`，测试照样绿 —— 于是 `guard.alarm`（受保护路径被拦、思考复读）
	// 就这么溜过去了，读者在拦截之后一条提示都看不到（真事：只剩「这一轮没有可见正文」）。
	// 现在改名也算丢 ✗。
	//
	// 只看**交集**：引擎自己产出的名字（如 `session.model_source_unavailable`）不在侧车
	// 发出名单里，它们由引擎改名、渲染层认新名 ✓，那是正确形状。
	var renamed []string
	for name := range emitted {
		if !rendererKnows[name] || keptVerbatim[name] || allowList[name] != "" {
			continue
		}
		if claimed[name] {
			renamed = append(renamed, name+" (claimed by the engine, but under a different name)")
			continue
		}
		renamed = append(renamed, name+" (not claimed: it falls through to engine.raw.<name>)")
	}
	sort.Strings(renamed)
	if len(renamed) > 0 {
		t.Fatalf(
			"the renderer switches on these names, but the engine does not keep them, so the "+
				"renderer can never match them:\n  %s",
			strings.Join(renamed, "\n  "),
		)
	}
}

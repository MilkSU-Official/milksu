package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBrowserExtensionSetupIsExposedToTheDesktopTrainingFlow(t *testing.T) {
	repositoryRoot, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	assertSourceContains := func(relativePath string, fragments ...string) {
		t.Helper()
		data, readErr := os.ReadFile(filepath.Join(repositoryRoot, relativePath))
		if readErr != nil {
			t.Fatal(readErr)
		}
		source := string(data)
		for _, fragment := range fragments {
			if !strings.Contains(source, fragment) {
				t.Fatalf("%s does not expose %q", relativePath, fragment)
			}
		}
	}

	assertSourceContains(
		"app/src/desktop.ts",
		"OpenChromeExtensionManager(): Promise<void>",
		"OpenPlaywrightBrowserExtension(): Promise<void>",
		"RevealBrowserExtension(): Promise<void>",
		"open_chrome_extension_manager",
		"open_playwright_browser_extension",
		"reveal_browser_extension",
	)
	assertSourceContains(
		"app/src/components-vue/SettingsPage.vue",
		"prepareBrowserExtension",
		"copyBrowserPairingCode",
		"本机浏览器配对码已复制",
		"不在界面显示明文",
		"浏览器与控制",
		"Playwright MCP 官方扩展",
	)
	assertSourceContains(
		"app/src/components-vue/CTFChallengeDesk.vue",
		"连接 NSSCTF Judge",
		"前往浏览器设置",
		"emit('openBrowserSettings')",
		"打开 P{{ selectedNssctf.platformId }}",
	)
	assertSourceContains(
		"browserextension/background.js",
		"type: 'hello'",
		"bridgeSessionIds:",
		"'milksu.bridge.status'",
		"if (bridgeSocket?.readyState === WebSocket.OPEN)",
		"await sendBridgeHello()",
		"await connectBridge()",
		"MilkSU 尚未运行，扩展会自动重连。",
	)
	assertSourceContains(
		"browserextension/popup.html",
		"MilkSU Bridge",
		"首次配对或更换 MilkSU",
		"配对码在 MilkSU 的“设置 → 浏览器与控制”里",
	)
	assertSourceContains(
		"browserextension/popup.js",
		"MilkSU 在线",
		"启动 MilkSU 后会自动重连，不需要重新配对。",
		"CTFshow 没有返回题库数据；请刷新页面或重新登录后再试",
		"CTFshow 题库接口格式已变化，当前适配器暂时无法读取",
		"if (!bridge?.paired)",
		"chrome.runtime.reload()",
	)
}

func TestBrowserExtensionSessionRefreshKeepsAHealthyBridgeOpen(t *testing.T) {
	data, err := os.ReadFile("browserextension/background.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	handlerStart := strings.Index(source, "if (message?.type === 'milksu.bridge.reconnect')")
	handlerEnd := strings.Index(source[handlerStart:], "if (message?.type === 'milksu.bridge.status')")
	if handlerStart < 0 || handlerEnd < 0 {
		t.Fatal("browser extension reconnect handler is missing")
	}
	handler := source[handlerStart : handlerStart+handlerEnd]
	for _, expected := range []string{
		"if (bridgeSocket?.readyState === WebSocket.OPEN)",
		"await sendBridgeHello()",
		"await connectBridge()",
		"return true",
	} {
		if !strings.Contains(handler, expected) {
			t.Fatalf("session refresh handler is missing %q", expected)
		}
	}
	if strings.Contains(handler, "bridgeSocket?.close()") {
		t.Fatal("session refresh must not close a healthy WebSocket")
	}
}

func TestBrowserPairingCodeIsCopyOnlyInTheDesktopUI(t *testing.T) {
	for _, path := range []string{
		"app/src/components-vue/SettingsPage.vue",
	} {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		source := string(data)
		for _, renderedSecret := range []string{
			"{{ browserPairingCode }}",
			"{{ pairingCode }}",
			"v-text=\"browserPairingCode\"",
			"v-text=\"pairingCode\"",
		} {
			if strings.Contains(source, renderedSecret) {
				t.Fatalf("%s renders the sensitive browser pairing code as text: %q", path, renderedSecret)
			}
		}
	}
}

func TestNSSCTFJudgeNeverPromisesToSpendCoins(t *testing.T) {
	var source strings.Builder
	for _, path := range []string{
		"app/src/components-vue/CTFPage.vue",
		"app/src/components-vue/CTFSubmissionGate.vue",
	} {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		source.Write(data)
	}
	for _, fragment := range []string{
		`selectedBrowserCanSubmit`,
		`activeBrowserCanSubmit`,
		`MilkSU 不会自动扣币`,
		`等待你在 NSSCTF 开启题目`,
	} {
		if !strings.Contains(source.String(), fragment) {
			t.Fatalf("NSSCTF Judge UI does not expose %q", fragment)
		}
	}
	for _, obsolete := range []string{
		`本次操作会先消耗`,
		`第一次提交会开启题目并消耗`,
		`花费 ${activeStartCost} 金币并提交`,
	} {
		if strings.Contains(source.String(), obsolete) {
			t.Fatalf("NSSCTF Judge UI still promises an automatic coin spend: %q", obsolete)
		}
	}
}

func TestNSSCTFJudgeRecognizesCurrentWrongFlagReceipt(t *testing.T) {
	data, err := os.ReadFile("browserextension/background.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	for _, expected := range []string{
		`world: 'MAIN'`,
		"fetch(`/api/problem/submit/${command.problemId}/`",
		`body: JSON.stringify({ flag: command.candidate })`,
		`const judgeCode = Number(payload?.code)`,
		`judgeCode === 200`,
		`[201, 202, 204, 205].includes(judgeCode)`,
		`message: receipt || 'flag有误，请重新提交。'`,
		`status: 'rejected'`,
		`correct: false`,
	} {
		if !strings.Contains(source, expected) {
			t.Fatalf("NSSCTF Judge adapter does not use the current structured receipt: %q", expected)
		}
	}
}

func TestCTFMemoryRequiresAConcludedReflectedRun(t *testing.T) {
	data, err := os.ReadFile("app/src/components-vue/CTFDebrief.vue")
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	for _, expected := range []string{
		"props.debrief.status !== 'in_progress'",
		"props.debrief.reflectionCount > 0",
		"题目结束后，再把 Judge 结果和解题复盘沉淀为记忆。",
		"先用你自己的话完成复盘，再保存为本机解题记忆。",
	} {
		if !strings.Contains(content, expected) {
			t.Fatalf("CTF debrief is missing guarded-memory UX %q", expected)
		}
	}
}

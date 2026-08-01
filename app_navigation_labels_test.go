package main

import (
	"os"
	"strings"
	"testing"
)

func TestPrimaryNavigationUsesConciseProductNames(t *testing.T) {
	files := []string{
		"app/src/components-vue/AppSidebar.vue",
		"app/src/components-vue/WorkspaceRail.vue",
		"app/src/components-vue/ContextSidebar.vue",
		"app/src/lib/workspaceNavigation.ts",
		"app/src/components-vue/CTFPage.vue",
		"app/src/components-vue/ChatPage.vue",
		"app/src/components-vue/VulnPage.vue",
	}
	var source strings.Builder
	for _, name := range files {
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		source.Write(data)
	}
	content := source.String()
	for _, fragment := range []string{
		"label: 'CTF'",
		"label: 'Coding'",
		"label: 'CVE'",
		">CTF</h1>",
		">Coding</h1>",
		">CVE</h1>",
	} {
		if !strings.Contains(content, fragment) {
			t.Fatalf("primary navigation does not expose %q", fragment)
		}
	}
	for _, obsolete := range []string{
		"label: 'CTF 训练'",
		"label: 'Coding Agent'",
		"label: 'CVE 追踪'",
	} {
		if strings.Contains(content, obsolete) {
			t.Fatalf("primary navigation still exposes %q", obsolete)
		}
	}
}

func TestManagedLabsStayOutOfTheDefaultRelease(t *testing.T) {
	t.Setenv("MILKSU_ENABLE_MANAGED_LABS", "")
	if managedLabsFeatureEnabled() {
		t.Fatal("managed labs must remain disabled in the default release")
	}
	t.Setenv("MILKSU_ENABLE_MANAGED_LABS", "1")
	if !managedLabsFeatureEnabled() {
		t.Fatal("the explicit developer feature flag should enable managed labs")
	}
}

func TestCTFPlatformChooserOwnsHistoryPairingAndCustomImport(t *testing.T) {
	data, err := os.ReadFile("app/src/components-vue/CTFPage.vue")
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	for _, fragment := range []string{
		`aria-label="选择训练平台"`,
		`<SelectItem value="custom">`,
		`aria-label="训练历史"`,
		`aria-label="浏览器连接"`,
		`复制配对码`,
		`新建自定义题目`,
		`只会在 MilkSU 建立本地工作区，不会上传到任何 CTF 网站`,
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("CTF product shell does not expose %q", fragment)
		}
	}
	for _, obsolete := range []string{
		`HTB CTF · Beta`,
		`继续上次</Button>`,
		`aria-label="下一步训练"`,
		`导入题目</Button>`,
	} {
		if strings.Contains(source, obsolete) {
			t.Fatalf("CTF product shell still exposes ambiguous control %q", obsolete)
		}
	}
}

func TestCTFAbilityLivesBehindTheSidebarAvatar(t *testing.T) {
	files := []string{
		"app/src/components-vue/AppSidebar.vue",
		"app/src/components-vue/WorkspaceRail.vue",
		"app/src/components-vue/ContextSidebar.vue",
	}
	var sidebarSource strings.Builder
	for _, name := range files {
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		sidebarSource.Write(data)
	}
	sidebar := sidebarSource.String()
	for _, fragment := range []string{
		`aria-label="查看 CTF 能力"`,
		`class="size-full rounded-full object-cover"`,
		`<AbilityRadar`,
		`aria-label="设置"`,
		`size="icon"`,
	} {
		if !strings.Contains(sidebar, fragment) {
			t.Fatalf("sidebar ability entry does not expose %q", fragment)
		}
	}

	deskData, err := os.ReadFile("app/src/components-vue/CTFChallengeDesk.vue")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(deskData), "<AbilityRadar") {
		t.Fatal("challenge detail still embeds the global ability card")
	}

	pageData, err := os.ReadFile("app/src/components-vue/CTFPage.vue")
	if err != nil {
		t.Fatal(err)
	}
	page := string(pageData)
	for _, obsolete := range []string{
		`<AbilityRadar`,
		`CTF 能力画像`,
		`aria-label="跨平台 CTF 能力画像"`,
	} {
		if strings.Contains(page, obsolete) {
			t.Fatalf("CTF page still duplicates the sidebar ability profile: %q", obsolete)
		}
	}
}

func TestCTFRecommendedProblemRemainsVisibleInTheList(t *testing.T) {
	data, err := os.ReadFile("app/src/components-vue/CTFChallengeDesk.vue")
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	for _, expected := range []string{
		"const displayedNssctfProblems = computed",
		"return [selected, ...props.nssctfProblems]",
		`v-for="problem in displayedNssctfProblems"`,
		"? '推荐' : '当前'",
	} {
		if !strings.Contains(source, expected) {
			t.Fatalf("CTF list does not keep the selected recommendation visible: %q", expected)
		}
	}
}

func TestCTFPrimaryActionOpensTheAgentAfterWorkspaceCreation(t *testing.T) {
	pageData, err := os.ReadFile("app/src/components-vue/CTFPage.vue")
	if err != nil {
		t.Fatal(err)
	}
	page := string(pageData)
	for _, expected := range []string{
		"await resumeJob(selectedActiveJob.value.id)",
		"if (props.modelReady) await openCodingAgent()",
		"screen.value = 'workspace'",
	} {
		if !strings.Contains(page, expected) {
			t.Fatalf("CTF primary action does not continue directly into the Agent: %q", expected)
		}
	}

	deskData, err := os.ReadFile("app/src/components-vue/CTFChallengeDesk.vue")
	if err != nil {
		t.Fatal(err)
	}
	desk := string(deskData)
	for _, expected := range []string{
		"if (!props.modelVerified) return 'settings'",
		"emit('openSettings')",
		"emit('startNssctf')",
		"'配置模型'",
		"'用 Agent 开始'",
	} {
		if !strings.Contains(desk, expected) {
			t.Fatalf("CTF primary action has an unclear prerequisite flow: %q", expected)
		}
	}
}

func TestCodingComposerKeepsOnlyMessageContextControls(t *testing.T) {
	data, err := os.ReadFile("app/src/components-vue/CodingComposerControls.vue")
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	for _, expected := range []string{
		`aria-label="Coding 执行模式"`,
		`aria-label="Coding 权限策略"`,
		`aria-label="选择本任务模型"`,
		`class="composer-control composer-model ml-auto`,
		`min-width: 10rem`,
	} {
		if !strings.Contains(source, expected) {
			t.Fatalf("Coding composer does not preserve the essential send-context control %q", expected)
		}
	}
	for _, duplicate := range []string{
		`chooseWorkspace`,
		`composer-workspace`,
		`Coding 快捷动作`,
		`设为目标`,
		`架构图`,
		`能力`,
	} {
		if strings.Contains(source, duplicate) {
			t.Fatalf("Coding composer duplicates the right-side environment action %q", duplicate)
		}
	}

	pageData, err := os.ReadFile("app/src/components-vue/ChatPage.vue")
	if err != nil {
		t.Fatal(err)
	}
	page := string(pageData)
	for _, expected := range []string{
		`v-if="!ctfSession && !workspaceLocked"`,
		`@click="$emit('chooseWorkspace')"`,
		`<SelectItem v-if="!ctfSession" value="architecture">架构图</SelectItem>`,
		`<p class="text-caption font-medium text-muted-foreground">任务操作</p>`,
		`<span class="shrink-0 text-muted-foreground">技能</span>`,
		`@media (max-width: 68.75rem)`,
		`width: 20rem;`,
		`@media (max-width: 56rem)`,
	} {
		if !strings.Contains(page, expected) {
			t.Fatalf("Coding right panel does not preserve responsive context ownership %q", expected)
		}
	}
}

func TestBrowserExtensionRejectsEmptyPairingCodeClearly(t *testing.T) {
	data, err := os.ReadFile("browserextension/popup.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	for _, fragment := range []string{
		`if (!raw)`,
		`请先从 MilkSU CTF 的“连接浏览器”复制并粘贴配对码`,
		`配对码无效，请回到 MilkSU CTF 重新复制`,
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("browser extension pairing flow does not expose %q", fragment)
		}
	}
}

func TestCTFChatExposesIndependentStrategyReview(t *testing.T) {
	data, err := os.ReadFile("app/src/components-vue/ChatPage.vue")
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	for _, fragment := range []string{
		`$emit('switchCtfAgent', 'strategist')`,
		`策略 Agent 复盘`,
		`独立审阅题面、轨迹与证据`,
		`不执行命令，不修改解题笔记或候选`,
		`复盘完成后返回验证`,
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("CTF strategy review flow does not expose %q", fragment)
		}
	}
}

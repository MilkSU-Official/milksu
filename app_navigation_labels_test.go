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
		"app/src/components-vue/CTFWorkspaceHeader.vue",
		"app/src/components-vue/ChatPage.vue",
		"app/src/components-vue/VulnPage.vue",
		"app/src/components-vue/WorkspaceModuleTopBar.vue",
		"app/src/components-vue/WorkspaceTopBar.vue",
		"app/src/components-vue/WorkspaceTopBarTitle.vue",
		"app/src/lib/chatTopbar.ts",
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
		`<WorkspaceModuleTopBar`,
		`coding: 'Coding'`,
		`ctf: 'CTF'`,
		`cve: 'CVE'`,
		`data-workspace-topbar-title`,
		`font-size: var(--module-topbar-title-size)`,
		`<h2 class="mb-2 px-0.5 text-control font-semibold">Coding</h2>`,
		`title: input.conversationTitle || '新编码任务'`,
	} {
		if !strings.Contains(content, fragment) {
			t.Fatalf("primary navigation does not expose %q", fragment)
		}
	}
	for _, page := range []string{
		"app/src/components-vue/CTFPage.vue",
		"app/src/components-vue/CTFWorkspaceHeader.vue",
		"app/src/components-vue/ChatPage.vue",
		"app/src/components-vue/VulnPage.vue",
	} {
		data, err := os.ReadFile(page)
		if err != nil {
			t.Fatal(err)
		}
		pageSource := string(data)
		for _, fragment := range []string{
			`import WorkspaceModuleTopBar`,
			`<WorkspaceModuleTopBar`,
		} {
			if !strings.Contains(pageSource, fragment) {
				t.Fatalf("%s does not render the shared module top bar: %q", page, fragment)
			}
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
		`aria-label="浏览器连接设置"`,
		`$emit('openSettings', 'browser')`,
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

func TestCTFAbilityLivesOnlyInTheGlobalWorkspaceRail(t *testing.T) {
	files := []string{
		"app/src/components-vue/AppSidebar.vue",
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
	for _, obsolete := range []string{
		`aria-label="查看 CTF 能力"`,
		`<AbilityRadar`,
		`class="size-full rounded-full object-cover"`,
	} {
		if strings.Contains(sidebar, obsolete) {
			t.Fatalf("sidebar still exposes removed CTF ability trigger: %q", obsolete)
		}
	}
	railData, err := os.ReadFile("app/src/components-vue/WorkspaceRail.vue")
	if err != nil {
		t.Fatal(err)
	}
	rail := string(railData)
	for _, expected := range []string{`aria-label="查看能力画像"`, `<AbilityRadar`} {
		if !strings.Contains(rail, expected) {
			t.Fatalf("global workspace rail lost the evidence-backed ability entry: %q", expected)
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

func TestCodingComposerKeepsOnlyPersistentMessageContextControls(t *testing.T) {
	data, err := os.ReadFile("app/src/components-vue/CodingComposerControls.vue")
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	for _, expected := range []string{
		`aria-label="Coding 权限策略"`,
		`aria-label="选择本任务模型"`,
		`class="composer-control composer-model`,
		`justify-self: end`,
	} {
		if !strings.Contains(source, expected) {
			t.Fatalf("Coding composer does not preserve the essential send-context control %q", expected)
		}
	}
	if strings.Contains(source, `aria-label="Coding 执行模式"`) {
		t.Fatal("Coding composer keeps a redundant persistent Plan/Go selector")
	}

	composerData, err := os.ReadFile("app/src/components-vue/ChatComposer.vue")
	if err != nil {
		t.Fatal(err)
	}
	composer := string(composerData)
	for _, expected := range []string{
		`aria-label="添加内容与工具"`,
		`文件或图片`,
		`目标`,
		`计划模式`,
		`退出计划模式`,
		`浏览器`,
		`Browser Use`,
		`Computer Use`,
		`前端视觉验收`,
		`data-composer-skill-token`,
		`项目 MCP`,
	} {
		if !strings.Contains(composer, expected) {
			t.Fatalf("Coding composer plus menu does not expose %q", expected)
		}
	}
	if strings.Contains(composer, `沙箱浏览器`) {
		t.Fatal("Coding composer exposes the internal sandbox browser label")
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
		`请先从 MilkSU 的“设置 → 浏览器与控制”复制并粘贴配对码`,
		`配对码无效，请回到 MilkSU 的浏览器设置重新复制`,
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

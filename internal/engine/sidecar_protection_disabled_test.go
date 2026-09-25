package engine

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/config"
)

// B2：读者的「紧急关闭」两条叶子通道（环境变量 / 数据目录标记文件）+ 合并设置开关。
// 硬要求：缺省与显式 false **都不得**关闭保护（静默失守比拦得住更糟 ✗）。
func TestAgentProtectionDisabledChannels(t *testing.T) {
	dir := t.TempDir()
	t.Setenv(appdata.DirectoryOverrideEnv, dir)
	t.Setenv("MILKSU_PROTECTED_DISABLED", "")

	// ① 缺省 / 显式 false：不得关闭保护
	if agentProtectionDisabled() {
		t.Fatal("缺省不得关闭保护")
	}
	off := false
	if agentProtectionDisabledFor(config.AppSettings{AgentProtectionDisabled: &off}) {
		t.Fatal("显式 false 不得关闭保护")
	}
	if agentProtectionDisabledFor(config.AppSettings{}) {
		t.Fatal("缺省（nil）不得关闭保护")
	}

	// ② 环境变量通道
	for _, value := range []string{"1", "true", "YES", "on"} {
		t.Setenv("MILKSU_PROTECTED_DISABLED", value)
		if !agentProtectionDisabled() {
			t.Fatalf("环境变量 %q 必须关闭整套保护", value)
		}
		if !agentProtectionDisabledFor(config.AppSettings{}) {
			t.Fatalf("环境变量 %q 也必须让 agentProtectionDisabledFor 生效", value)
		}
	}
	t.Setenv("MILKSU_PROTECTED_DISABLED", "0")
	if agentProtectionDisabled() {
		t.Fatal("0 不算开启（只有 1/true/yes/on ✓）")
	}

	// ③ 数据目录标记文件通道（用临时目录真测 ✓，不碰真实数据目录 ✗）
	marker := filepath.Join(dir, "agent-protection-off")
	if err := os.WriteFile(marker, []byte("off"), 0o644); err != nil {
		t.Fatalf("写标记文件: %v", err)
	}
	if !agentProtectionDisabled() {
		t.Fatal("标记文件必须关闭整套保护（界面坏掉时读者自己就能建 ✓）")
	}
	if err := os.Remove(marker); err != nil {
		t.Fatal(err)
	}
	if agentProtectionDisabled() {
		t.Fatal("标记文件删掉后必须恢复保护")
	}

	// ④ 设置开关通道（界面里的紧急开关 ✓）
	on := true
	if !agentProtectionDisabledFor(config.AppSettings{AgentProtectionDisabled: &on}) {
		t.Fatal("设置开关必须关闭整套保护")
	}
}

package engine

import (
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

// B3：受保护根汇聚接线的集成用例（覆盖变量 + 临时目录 ✓，不碰真实数据目录 ✗）。
// 读者口径：运行时数据 / 会话记录**任何渠道**都保护 ✓；beta 才豁免 App 本体 ✓；
// stable 与渠道未知一律保护包本体 ✓；紧急关闭 ⇒ 什么都不下发 ✓。
func TestProtectedRootsVariableChannels(t *testing.T) {
	t.Setenv(appdata.DirectoryOverrideEnv, t.TempDir())
	t.Setenv("MILKSU_PROTECTED_DISABLED", "")

	t.Setenv("MILKSU_CHANNEL", "stable")
	stable := protectedRootsVariable()
	if !strings.Contains(stable, "runtime-data") {
		t.Fatalf("stable 必须下发运行时数据受保护根：%q", stable)
	}
	if !strings.Contains(stable, "pi-sessions") {
		t.Fatalf("stable 必须下发会话记录受保护根：%q", stable)
	}

	t.Setenv("MILKSU_CHANNEL", "beta")
	beta := protectedRootsVariable()
	// ⚠️ 这里**不**断言 app-bundle：测试进程不在 .app 里 ⇒ appBundleRoot() 恒空 ✗ ⇒
	// 在 protectedRootsVariable() 上断言会得到永远为假的假守卫 ✗。渠道口径由 B1 的
	// 纯函数用例（TestAppBundleProtectedRootChannelRule ✓）负责 ✓。
	if !strings.Contains(beta, "runtime-data") || !strings.Contains(beta, "pi-sessions") {
		t.Fatalf("beta 也必须保护运行时数据与会话记录（任何渠道都保护）：%q", beta)
	}

	t.Setenv("MILKSU_CHANNEL", "some-future-channel")
	if got := protectedRootsVariable(); !strings.Contains(got, "runtime-data") {
		t.Fatalf("渠道未知也必须保护运行时数据：%q", got)
	}

	t.Setenv("MILKSU_PROTECTED_DISABLED", "1")
	if got := protectedRootsVariable(); got != "" {
		t.Fatalf("紧急关闭必须不下发任何受保护根（得到 %q）", got)
	}
}

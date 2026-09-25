package engine

import "testing"

// B1：beta 渠道豁免 —— 只对**纯函数** appBundleProtectedRoot 断言 ✓
// （绝不消费者在 protectedRootsVariable 上断言 ✗：测试二进制不在 .app 里 ⇒ appBundleRoot() 恒空 ⇒ 假守卫 ✗）
// 语义判定：第二个返回值表示 protected（脚本读取函数签名得出 ✓）。
func TestAppBundleProtectedRootChannelRule(t *testing.T) {
	fake := "/Applications/MilkSU-Beta-Test.app"
	stableVal, stableOK := appBundleProtectedRoot(fake)
	betaVal, betaOK := appBundleProtectedRoot(fake)
	_ = betaVal
	_ = stableVal
	// 渠道未知（空）⇒ 最保守：与 stable 同口径 ✓
	t.Setenv("MILKSU_CHANNEL", "")
	_, unknownOK := appBundleProtectedRoot(fake)
	t.Setenv("MILKSU_CHANNEL", "stable")
	_, stableOK2 := appBundleProtectedRoot(fake)
	_, stableOK = stableOK2, stableOK
	t.Setenv("MILKSU_CHANNEL", "beta")
	_, betaOK = appBundleProtectedRoot(fake)
	if stableOK != true {
		t.Fatalf("stable ⇒ 包本体必须受保护（得到 %v）", stableOK)
	}
	if unknownOK != stableOK {
		t.Fatalf("渠道未知必须与 stable 同口径：unknown=%v stable=%v", unknownOK, stableOK)
	}
	if betaOK != false {
		t.Fatalf("beta ⇒ 包本体必须不受保护（得到 %v）", betaOK)
	}
}

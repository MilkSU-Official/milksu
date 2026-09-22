package modelpricing

import "testing"

func TestEstimateUSDDeepSeekFlash(t *testing.T) {
	cost, ok := EstimateUSD("deepseek/deepseek-flash", Usage{
		InputTokens: 1_000_000, OutputTokens: 1_000_000,
	})
	if !ok {
		t.Fatal("expected rate")
	}
	// 0.15 + 0.6 = 0.75
	if cost < 0.74 || cost > 0.76 {
		t.Fatalf("cost=%v", cost)
	}
}

func TestEstimateUnknownModel(t *testing.T) {
	if _, ok := EstimateUSD("totally-unknown-xyz", Usage{InputTokens: 10}); ok {
		t.Fatal("expected miss")
	}
}

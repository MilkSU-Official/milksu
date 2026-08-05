package nssctf

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

func TestLivePublicChallengeSmoke(t *testing.T) {
	if os.Getenv("MILKSU_LIVE_NSSCTF") != "1" {
		t.Skip("set MILKSU_LIVE_NSSCTF=1 to run the live public NSSCTF adapter smoke test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	challenge, err := NewClient(ClientOptions{}).ImportChallenge(
		ctx,
		"https://www.nssctf.cn/problem/316",
	)
	if err != nil {
		t.Fatal(err)
	}
	if challenge.Platform != "NSSCTF" ||
		challenge.PlatformID != 316 ||
		strings.TrimSpace(challenge.Title) == "" ||
		strings.TrimSpace(challenge.Statement) == "" ||
		challenge.SourceURL != "https://www.nssctf.cn/problem/316" {
		t.Fatalf("unexpected live NSSCTF challenge: %#v", challenge)
	}
}

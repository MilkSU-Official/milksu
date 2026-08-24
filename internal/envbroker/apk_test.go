package envbroker

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestCacheAndroidAPKRejectsBadHash(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	source := filepath.Join(root, "source.apk")
	if err := os.WriteFile(source, []byte("apk-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := cacheAndroidAPK(context.Background(), fileAPKFetcher{source: source}, root, Package{
		ApkURL:    "https://example.invalid/app.apk",
		ApkName:   "app.apk",
		ApkSHA256: "deadbeef",
	})
	if err == nil {
		t.Fatal("expected hash mismatch")
	}
	if _, statErr := os.Stat(filepath.Join(root, "envbroker", "cache", "app.apk")); !os.IsNotExist(statErr) {
		t.Fatalf("rejected APK should not remain in cache: %v", statErr)
	}
}

func TestCacheAndroidAPKReusesVerifiedFile(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	payload := []byte("apk-bytes")
	sum := sha256.Sum256(payload)
	source := filepath.Join(root, "source.apk")
	if err := os.WriteFile(source, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	item := Package{
		ApkURL:    "https://example.invalid/app.apk",
		ApkName:   "app.apk",
		ApkSHA256: hex.EncodeToString(sum[:]),
	}
	first, err := cacheAndroidAPK(context.Background(), fileAPKFetcher{source: source}, root, item)
	if err != nil {
		t.Fatal(err)
	}
	second, err := cacheAndroidAPK(context.Background(), fileAPKFetcher{source: filepath.Join(root, "missing.apk")}, root, item)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("cache path changed: %s %s", first, second)
	}
}

func TestInstallAndroidLabRequiresSuccess(t *testing.T) {
	t.Parallel()
	runner := &fakeAndroid{avds: []string{"Pixel"}, booted: true}
	if err := installAndroidLab(context.Background(), runner, "emulator-5554", "/tmp/app.apk", "b3nac.injuredandroid/.MainActivity"); err != nil {
		t.Fatal(err)
	}
	if androidPackageName("b3nac.injuredandroid/.MainActivity") != "b3nac.injuredandroid" {
		t.Fatal(androidPackageName("b3nac.injuredandroid/.MainActivity"))
	}
}

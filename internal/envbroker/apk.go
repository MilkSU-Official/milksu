package envbroker

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type apkFetcher interface {
	Fetch(ctx context.Context, url, destination string) error
}

type httpAPKFetcher struct{}

func (httpAPKFetcher) Fetch(ctx context.Context, url, destination string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 3 * time.Minute}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("下载 APK 失败: HTTP %d", response.StatusCode)
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return err
	}
	file, err := os.Create(destination)
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err := io.Copy(file, io.LimitReader(response.Body, 80<<20)); err != nil {
		return err
	}
	return nil
}

func cacheAndroidAPK(ctx context.Context, fetcher apkFetcher, dataDirectory string, item Package) (string, error) {
	if item.ApkURL == "" || item.ApkName == "" || item.ApkSHA256 == "" {
		return "", fmt.Errorf("练习包没有钉死 APK")
	}
	directory := filepath.Join(dataDirectory, "envbroker", "cache")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(directory, item.ApkName)
	if matchAPKHash(path, item.ApkSHA256) {
		return path, nil
	}
	_ = os.Remove(path)
	if fetcher == nil {
		fetcher = httpAPKFetcher{}
	}
	if err := fetcher.Fetch(ctx, item.ApkURL, path); err != nil {
		_ = os.Remove(path)
		return "", err
	}
	if !matchAPKHash(path, item.ApkSHA256) {
		_ = os.Remove(path)
		return "", fmt.Errorf("APK 校验失败，与钉死的 SHA-256 不一致")
	}
	return path, nil
}

func matchAPKHash(path, want string) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	sum := sha256.Sum256(data)
	return strings.EqualFold(hex.EncodeToString(sum[:]), strings.TrimSpace(want))
}

func installAndroidLab(ctx context.Context, runner androidRunner, serial, apkPath, launcher string) error {
	adb, err := runner.LookPath("adb")
	if err != nil {
		return err
	}
	if serial == "" {
		serial = "emulator-5554"
	}
	output, installErr := runner.CombinedOutput(ctx, adb, "-s", serial, "install", "-r", "-t", apkPath)
	if installErr != nil {
		return fmt.Errorf("安装练习 APK 失败: %s", strings.TrimSpace(string(output)))
	}
	if launcher == "" {
		return nil
	}
	_, _ = runner.CombinedOutput(ctx, adb, "-s", serial, "shell", "am", "start", "-n", launcher)
	return nil
}

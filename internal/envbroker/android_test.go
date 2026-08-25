package envbroker

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestAndroidSDKCandidatesCoverWindowsAndLinuxHomes(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("LOCALAPPDATA", filepath.Join(home, "AppData", "Local"))
	t.Setenv("ANDROID_HOME", "")
	t.Setenv("ANDROID_SDK_ROOT", "")
	candidates := androidSDKCandidates()
	joined := strings.Join(candidates, "\n")
	if !strings.Contains(joined, filepath.Join(home, "Android", "Sdk")) {
		t.Fatalf("missing Linux/cross-platform SDK home: %s", joined)
	}
	if !strings.Contains(joined, filepath.Join(home, "AppData", "Local", "Android", "Sdk")) {
		t.Fatalf("missing Windows SDK home: %s", joined)
	}
}

func TestLookPathPrefersConfiguredSDKOverEnv(t *testing.T) {
	configured := t.TempDir()
	want := filepath.Join(configured, "cmdline-tools", "latest", "bin", "avdmanager")
	if err := os.MkdirAll(filepath.Dir(want), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(want, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	envSDK := t.TempDir()
	t.Setenv("ANDROID_HOME", envSDK)
	t.Setenv("ANDROID_SDK_ROOT", envSDK)
	got, err := execAndroidRunner{sdkRoot: configured}.LookPath("avdmanager")
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("LookPath avdmanager=%s want configured SDK %s", got, want)
	}
}

func TestLookPathPrefersSDKAvdmanager(t *testing.T) {
	sdk := t.TempDir()
	want := filepath.Join(sdk, "cmdline-tools", "latest", "bin", "avdmanager")
	if err := os.MkdirAll(filepath.Dir(want), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(want, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ANDROID_HOME", sdk)
	t.Setenv("ANDROID_SDK_ROOT", sdk)
	got, err := execAndroidRunner{}.LookPath("avdmanager")
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("LookPath avdmanager=%s want %s", got, want)
	}
}

func TestLookPathFindsBrewCommandLineToolsWhenSDKHasNone(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("Homebrew cmdline-tools live on macOS")
	}
	brew := "/opt/homebrew/share/android-commandlinetools/cmdline-tools/latest/bin/avdmanager"
	if !androidToolExists(brew) {
		t.Skip("brew android-commandlinetools not installed")
	}
	empty := t.TempDir()
	t.Setenv("ANDROID_HOME", empty)
	t.Setenv("ANDROID_SDK_ROOT", empty)
	got, err := execAndroidRunner{}.LookPath("avdmanager")
	if err != nil {
		t.Fatal(err)
	}
	if got != brew {
		t.Fatalf("LookPath avdmanager=%s want brew cmdline-tools %s", got, brew)
	}
}

func TestAndroidJavaHomeUsesConfiguredHome(t *testing.T) {
	home := t.TempDir()
	bin := filepath.Join(home, "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	java := filepath.Join(bin, "java")
	if runtime.GOOS == "windows" {
		java += ".exe"
	}
	if err := os.WriteFile(java, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("JAVA_HOME", home)
	if got := androidJavaHome(); got != home {
		t.Fatalf("androidJavaHome=%s want %s", got, home)
	}
}

func TestAndroidJavaHomeIgnoresEmptyOrInvalid(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "missing")
	t.Setenv("JAVA_HOME", missing)
	got := androidJavaHome()
	if got == missing {
		t.Fatal("accepted missing JAVA_HOME")
	}
	if runtime.GOOS == "darwin" && got == "" {
		if !androidToolExists("/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home/bin/java") {
			t.Skip("no Homebrew OpenJDK to fall back to")
		}
		t.Fatal("expected Homebrew OpenJDK fallback")
	}
}

func TestAndroidProcessEnvInjectsJavaAndSDK(t *testing.T) {
	sdk := t.TempDir()
	if err := os.MkdirAll(sdk, 0o755); err != nil {
		t.Fatal(err)
	}
	home := t.TempDir()
	bin := filepath.Join(home, "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	java := filepath.Join(bin, "java")
	if runtime.GOOS == "windows" {
		java += ".exe"
	}
	if err := os.WriteFile(java, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ANDROID_HOME", sdk)
	t.Setenv("ANDROID_SDK_ROOT", sdk)
	t.Setenv("JAVA_HOME", home)
	env := androidProcessEnv()
	foundJava := false
	foundSDK := false
	foundPath := false
	for _, item := range env {
		switch {
		case item == "JAVA_HOME="+home:
			foundJava = true
		case item == "ANDROID_HOME="+sdk:
			foundSDK = true
		case strings.HasPrefix(item, "PATH="+bin+string(os.PathListSeparator)):
			foundPath = true
		}
	}
	if !foundJava || !foundSDK || !foundPath {
		t.Fatalf("env missing java/sdk/path: java=%v sdk=%v path=%v", foundJava, foundSDK, foundPath)
	}
}

func TestFormatLabAVDCreateErrorHidesJavaStub(t *testing.T) {
	err := formatLabAVDCreateError("MilkSU-Lab", []byte(`/opt/homebrew/bin/avdmanager: line 173: test: : integer expression expected
The operation couldn’t be completed. Unable to locate a Java Runtime.
Please visit http://www.java.com for information on installing Java.`), errors.New("exit status 1"))
	text := err.Error()
	if !strings.Contains(text, "Android Studio") || !strings.Contains(text, "Lab") {
		t.Fatalf("want product setup guidance, got %s", text)
	}
	if strings.Contains(text, "integer expression expected") || strings.Contains(text, "/opt/homebrew/bin/avdmanager") || strings.Contains(text, "brew install") {
		t.Fatalf("leaked raw avdmanager output: %s", text)
	}
}

func TestAVDManagerListRunsWithInjectedJava(t *testing.T) {
	if testing.Short() {
		t.Skip("live avdmanager")
	}
	manager, err := execAndroidRunner{}.LookPath("avdmanager")
	if err != nil {
		t.Skip(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	output, runErr := execAndroidRunner{}.CombinedOutput(ctx, manager, "list", "avd")
	if runErr != nil {
		t.Fatalf("avdmanager list avd: %v\n%s", runErr, output)
	}
	if strings.Contains(string(output), "Unable to locate a Java Runtime") {
		t.Fatalf("java stub still reached:\n%s", output)
	}
}

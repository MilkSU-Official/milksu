package envbroker

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type androidRunner interface {
	LookPath(name string) (string, error)
	CombinedOutput(ctx context.Context, name string, args ...string) ([]byte, error)
	StartDetached(name string, args ...string) error
}

type execAndroidRunner struct{}

func (execAndroidRunner) LookPath(name string) (string, error) {
	if path, err := exec.LookPath(name); err == nil {
		return path, nil
	}
	home, _ := os.UserHomeDir()
	sdk := strings.TrimSpace(os.Getenv("ANDROID_HOME"))
	if sdk == "" {
		sdk = strings.TrimSpace(os.Getenv("ANDROID_SDK_ROOT"))
	}
	if sdk == "" && home != "" {
		sdk = filepath.Join(home, "Library", "Android", "sdk")
	}
	candidates := map[string][]string{
		"emulator": {
			filepath.Join(sdk, "emulator", "emulator"),
			filepath.Join(sdk, "emulator", "emulator.exe"),
		},
		"adb": {
			filepath.Join(sdk, "platform-tools", "adb"),
			filepath.Join(sdk, "platform-tools", "adb.exe"),
		},
	}
	for _, candidate := range candidates[name] {
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0o111 != 0 {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("%s not found", name)
}

func (execAndroidRunner) CombinedOutput(ctx context.Context, name string, args ...string) ([]byte, error) {
	command := exec.CommandContext(ctx, name, args...)
	return command.CombinedOutput()
}

func (execAndroidRunner) StartDetached(name string, args ...string) error {
	command := exec.Command(name, args...)
	command.Stdout = nil
	command.Stderr = nil
	command.Env = os.Environ()
	if home := strings.TrimSpace(os.Getenv("ANDROID_HOME")); home == "" {
		if sdk := strings.TrimSpace(os.Getenv("ANDROID_SDK_ROOT")); sdk != "" {
			command.Env = append(command.Env, "ANDROID_HOME="+sdk, "ANDROID_SDK_ROOT="+sdk)
		} else if userHome, err := os.UserHomeDir(); err == nil {
			sdk = filepath.Join(userHome, "Library", "Android", "sdk")
			command.Env = append(command.Env, "ANDROID_HOME="+sdk, "ANDROID_SDK_ROOT="+sdk)
		}
	}
	withDetach(command)
	if err := command.Start(); err != nil {
		return err
	}
	return command.Process.Release()
}

func listAvds(runner androidRunner) ([]string, error) {
	emulator, err := runner.LookPath("emulator")
	if err != nil {
		return nil, fmt.Errorf("没有 Android 模拟器。请先安装 Android SDK 并创建一个 AVD")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	output, runErr := runner.CombinedOutput(ctx, emulator, "-list-avds")
	if runErr != nil {
		return nil, fmt.Errorf("无法列出 AVD: %s", strings.TrimSpace(string(output)))
	}
	var names []string
	for _, line := range strings.Split(string(output), "\n") {
		name := strings.TrimSpace(line)
		if name != "" && !strings.HasPrefix(name, "INFO") {
			names = append(names, name)
		}
	}
	if len(names) == 0 {
		return nil, fmt.Errorf("没有可用的 AVD。请先在 Android Studio 里创建一个模拟器")
	}
	return names, nil
}

func startAndroid(ctx context.Context, runner androidRunner) (string, error) {
	names, err := listAvds(runner)
	if err != nil {
		return "", err
	}
	adb, err := runner.LookPath("adb")
	if err != nil {
		return "", fmt.Errorf("没有 adb。请安装 Android platform-tools")
	}
	if serial, ready := androidSerial(ctx, runner, adb); ready {
		return serial, nil
	}
	emulator, err := runner.LookPath("emulator")
	if err != nil {
		return "", err
	}
	if err := runner.StartDetached(emulator, "-avd", names[0], "-netdelay", "none", "-netspeed", "full", "-gpu", "auto"); err != nil {
		return "", fmt.Errorf("启动模拟器失败: %w", err)
	}
	deadline := time.Now().Add(3 * time.Minute)
	for {
		if serial, ready := androidSerial(ctx, runner, adb); ready {
			return serial, nil
		}
		if time.Now().After(deadline) {
			return "", fmt.Errorf("模拟器启动超时。请检查 Android Studio / SDK")
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(400 * time.Millisecond):
		}
	}
}

func androidStatus(ctx context.Context, runner androidRunner) (string, string, error) {
	adb, err := runner.LookPath("adb")
	if err != nil {
		return "", "stopped", fmt.Errorf("没有 adb")
	}
	serial, ready := androidSerial(ctx, runner, adb)
	if !ready {
		return "", "stopped", nil
	}
	return serial, "ready", nil
}

func stopAndroid(ctx context.Context, runner androidRunner, serial string) error {
	adb, err := runner.LookPath("adb")
	if err != nil {
		return err
	}
	if serial == "" {
		serial = "emulator-5554"
	}
	_, _ = runner.CombinedOutput(ctx, adb, "-s", serial, "emu", "kill")
	return nil
}

func androidSerial(ctx context.Context, runner androidRunner, adb string) (string, bool) {
	commandContext, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	output, err := runner.CombinedOutput(commandContext, adb, "devices")
	if err != nil {
		return "", false
	}
	serial := ""
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "emulator-") && strings.Contains(line, "device") && !strings.Contains(line, "offline") {
			fields := strings.Fields(line)
			if len(fields) >= 1 {
				serial = fields[0]
				break
			}
		}
	}
	if serial == "" {
		return "", false
	}
	bootContext, bootCancel := context.WithTimeout(ctx, 5*time.Second)
	defer bootCancel()
	boot, err := runner.CombinedOutput(bootContext, adb, "-s", serial, "shell", "getprop", "sys.boot_completed")
	if err != nil {
		return serial, false
	}
	return serial, bytes.Contains(boot, []byte("1"))
}

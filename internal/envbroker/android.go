package envbroker

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const labAVDPrefix = "MilkSU-Lab"

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
	for _, sdk := range androidSDKRoots() {
		candidates := map[string][]string{
			"emulator": {
				filepath.Join(sdk, "emulator", "emulator"),
				filepath.Join(sdk, "emulator", "emulator.exe"),
			},
			"adb": {
				filepath.Join(sdk, "platform-tools", "adb"),
				filepath.Join(sdk, "platform-tools", "adb.exe"),
			},
			"avdmanager": {
				filepath.Join(sdk, "cmdline-tools", "latest", "bin", "avdmanager"),
				filepath.Join(sdk, "cmdline-tools", "latest", "bin", "avdmanager.bat"),
			},
		}
		for _, candidate := range candidates[name] {
			if androidToolExists(candidate) {
				return candidate, nil
			}
		}
	}
	if path, err := exec.LookPath(name); err == nil {
		return path, nil
	}
	return "", fmt.Errorf("%s not found", name)
}

func androidSDKRoots() []string {
	var roots []string
	for _, key := range []string{"ANDROID_HOME", "ANDROID_SDK_ROOT"} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			roots = append(roots, value)
		}
	}
	home, err := os.UserHomeDir()
	if err == nil && home != "" {
		roots = append(roots,
			filepath.Join(home, "Library", "Android", "sdk"),
			filepath.Join(home, "Android", "Sdk"),
		)
	}
	if local := strings.TrimSpace(os.Getenv("LOCALAPPDATA")); local != "" {
		roots = append(roots, filepath.Join(local, "Android", "Sdk"))
	}
	return roots
}

func androidToolExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	if runtime.GOOS == "windows" {
		return true
	}
	return info.Mode().Perm()&0o111 != 0
}

func (r execAndroidRunner) CombinedOutput(ctx context.Context, name string, args ...string) ([]byte, error) {
	command := exec.CommandContext(ctx, name, args...)
	command.Env = os.Environ()
	if isAVDManagerCreate(name, args) {
		command.Stdin = strings.NewReader("no\n")
	}
	return command.CombinedOutput()
}

func isAVDManagerCreate(name string, args []string) bool {
	base := strings.ToLower(filepath.Base(name))
	if base != "avdmanager" && base != "avdmanager.bat" {
		return false
	}
	joined := strings.Join(args, " ")
	return strings.Contains(joined, "create avd")
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
		return nil, fmt.Errorf("没有 Android 模拟器。请先安装 Android SDK")
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
	return names, nil
}

func labAVDs(names []string) []string {
	var out []string
	for _, name := range names {
		if strings.HasPrefix(name, labAVDPrefix) {
			out = append(out, name)
		}
	}
	return out
}

func nextLabAVDName(existing []string) string {
	used := map[string]bool{}
	for _, name := range existing {
		used[name] = true
	}
	if !used[labAVDPrefix] {
		return labAVDPrefix
	}
	for i := 2; i < 16; i++ {
		name := fmt.Sprintf("%s-%d", labAVDPrefix, i)
		if !used[name] {
			return name
		}
	}
	return ""
}

var detectLabSystemImage = findLabSystemImage

func findLabSystemImage() string {
	abi := "x86_64"
	if runtime.GOARCH == "arm64" {
		abi = "arm64-v8a"
	}
	for _, sdk := range androidSDKRoots() {
		root := filepath.Join(sdk, "system-images")
		entries, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for i := len(entries) - 1; i >= 0; i-- {
			api := entries[i]
			if !api.IsDir() {
				continue
			}
			for _, tag := range []string{"google_apis", "google_apis_playstore", "default"} {
				candidate := filepath.Join(root, api.Name(), tag, abi)
				if info, err := os.Stat(candidate); err == nil && info.IsDir() {
					return "system-images;" + api.Name() + ";" + tag + ";" + abi
				}
			}
		}
	}
	return ""
}

func ensureLabAVD(ctx context.Context, runner androidRunner) (string, error) {
	names, err := listAvds(runner)
	if err != nil {
		return "", err
	}
	if labs := labAVDs(names); len(labs) > 0 {
		return labs[0], nil
	}
	image := detectLabSystemImage()
	if image == "" {
		return "", fmt.Errorf("没有 MilkSU 实验室模拟器。请在 Android Studio 创建一个名为 %s 的 AVD，不要用日常手机模拟器", labAVDPrefix)
	}
	manager, err := runner.LookPath("avdmanager")
	if err != nil {
		return "", fmt.Errorf("没有 avdmanager，无法创建 %s。请先在 Android Studio 创建该 AVD", labAVDPrefix)
	}
	output, createErr := runner.CombinedOutput(ctx, manager, "create", "avd", "--force", "--name", labAVDPrefix, "--package", image, "--device", "pixel")
	if createErr != nil {
		return "", fmt.Errorf("创建 %s 失败: %s", labAVDPrefix, strings.TrimSpace(string(output)))
	}
	return labAVDPrefix, nil
}

type androidDevice struct {
	AVD    string
	Serial string
	Port   int
}

func emulatorPort(serial string) int {
	serial = strings.TrimSpace(serial)
	if !strings.HasPrefix(serial, "emulator-") {
		return 0
	}
	port, err := strconv.Atoi(strings.TrimPrefix(serial, "emulator-"))
	if err != nil {
		return 0
	}
	return port
}

func nextFreeEmulatorPort(usedSerials map[string]bool) int {
	used := map[int]bool{}
	for serial := range usedSerials {
		if port := emulatorPort(serial); port > 0 {
			used[port] = true
		}
	}
	for port := 5554; port <= 5584; port += 2 {
		if !used[port] {
			return port
		}
	}
	return 0
}

func runningLabDevices(ctx context.Context, runner androidRunner, adb string) []androidDevice {
	output, err := runner.CombinedOutput(ctx, adb, "devices")
	if err != nil {
		return nil
	}
	var devices []androidDevice
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "emulator-") || !strings.Contains(line, "device") || strings.Contains(line, "offline") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 1 {
			continue
		}
		serial := fields[0]
		nameOut, nameErr := runner.CombinedOutput(ctx, adb, "-s", serial, "emu", "avd", "name")
		name := strings.TrimSpace(strings.SplitN(string(nameOut), "\n", 2)[0])
		if nameErr != nil || !strings.HasPrefix(name, labAVDPrefix) {
			continue
		}
		devices = append(devices, androidDevice{AVD: name, Serial: serial, Port: emulatorPort(serial)})
	}
	return devices
}

func allocateAndroidDevice(ctx context.Context, runner androidRunner, heldDevices, heldSerials map[string]bool) (androidDevice, error) {
	if heldDevices == nil {
		heldDevices = map[string]bool{}
	}
	if heldSerials == nil {
		heldSerials = map[string]bool{}
	}
	if _, err := ensureLabAVD(ctx, runner); err != nil {
		return androidDevice{}, err
	}
	adb, err := runner.LookPath("adb")
	if err != nil {
		return androidDevice{}, fmt.Errorf("没有 adb。请安装 Android platform-tools")
	}
	for _, device := range runningLabDevices(ctx, runner, adb) {
		if heldDevices[device.AVD] || heldSerials[device.Serial] {
			continue
		}
		if ready, _ := androidSerialReady(ctx, runner, adb, device.Serial); ready {
			return device, nil
		}
	}
	names, err := listAvds(runner)
	if err != nil {
		return androidDevice{}, err
	}
	labs := labAVDs(names)
	running := map[string]bool{}
	for _, device := range runningLabDevices(ctx, runner, adb) {
		running[device.AVD] = true
	}
	pick := ""
	for _, name := range labs {
		if heldDevices[name] || running[name] {
			continue
		}
		pick = name
		break
	}
	if pick == "" {
		next := nextLabAVDName(labs)
		if next == "" {
			return androidDevice{}, errAndroidBusy
		}
		image := detectLabSystemImage()
		if image == "" {
			return androidDevice{}, errAndroidBusy
		}
		manager, lookErr := runner.LookPath("avdmanager")
		if lookErr != nil {
			return androidDevice{}, errAndroidBusy
		}
		if output, createErr := runner.CombinedOutput(ctx, manager, "create", "avd", "--force", "--name", next, "--package", image, "--device", "pixel"); createErr != nil {
			return androidDevice{}, fmt.Errorf("无法再开一台实验室模拟器: %s", strings.TrimSpace(string(output)))
		}
		pick = next
	}
	port := nextFreeEmulatorPort(heldSerials)
	if port == 0 {
		return androidDevice{}, errAndroidBusy
	}
	emulator, err := runner.LookPath("emulator")
	if err != nil {
		return androidDevice{}, err
	}
	if err := runner.StartDetached(emulator, "-avd", pick, "-port", strconv.Itoa(port), "-netdelay", "none", "-netspeed", "full", "-gpu", "auto"); err != nil {
		return androidDevice{}, fmt.Errorf("启动模拟器失败: %w", err)
	}
	serial := fmt.Sprintf("emulator-%d", port)
	deadline := time.Now().Add(3 * time.Minute)
	for {
		if ready, _ := androidSerialReady(ctx, runner, adb, serial); ready {
			return androidDevice{AVD: pick, Serial: serial, Port: port}, nil
		}
		if time.Now().After(deadline) {
			return androidDevice{}, fmt.Errorf("实验室模拟器 %s 启动超时", pick)
		}
		select {
		case <-ctx.Done():
			return androidDevice{}, ctx.Err()
		case <-time.After(400 * time.Millisecond):
		}
	}
}

var errAndroidBusy = fmt.Errorf("实验室模拟器都被占用")

func androidStatus(ctx context.Context, runner androidRunner, serial string) (string, string, error) {
	adb, err := runner.LookPath("adb")
	if err != nil {
		return "", "stopped", fmt.Errorf("没有 adb")
	}
	if serial != "" {
		if ready, live := androidSerialReady(ctx, runner, adb, serial); ready {
			return live, "ready", nil
		}
		return serial, "stopped", nil
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
		return nil
	}
	_, _ = runner.CombinedOutput(ctx, adb, "-s", serial, "emu", "kill")
	return nil
}

func androidSerial(ctx context.Context, runner androidRunner, adb string) (string, bool) {
	for _, device := range runningLabDevices(ctx, runner, adb) {
		if ready, serial := androidSerialReady(ctx, runner, adb, device.Serial); ready {
			return serial, true
		}
	}
	return "", false
}

func androidSerialReady(ctx context.Context, runner androidRunner, adb, serial string) (bool, string) {
	if serial == "" {
		return false, ""
	}
	commandContext, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	boot, err := runner.CombinedOutput(commandContext, adb, "-s", serial, "shell", "getprop", "sys.boot_completed")
	if err != nil {
		return false, serial
	}
	return bytes.Contains(boot, []byte("1")), serial
}

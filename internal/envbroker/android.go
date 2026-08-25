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

type execAndroidRunner struct {
	sdkRoot  string
	javaHome string
}

func (r execAndroidRunner) LookPath(name string) (string, error) {
	for _, candidate := range androidToolCandidatesIn(name, r.sdkRoots()) {
		if androidToolExists(candidate) {
			return candidate, nil
		}
	}
	if path, err := exec.LookPath(name); err == nil {
		return path, nil
	}
	return "", fmt.Errorf("%s not found", name)
}

func (r execAndroidRunner) sdkRoots() []string {
	return androidSDKRootsWith(r.sdkRoot)
}

func androidSDKRootsWith(override string) []string {
	var roots []string
	if strings.TrimSpace(override) != "" {
		roots = append(roots, strings.TrimSpace(override))
	}
	roots = append(roots, androidSDKRoots()...)
	seen := map[string]bool{}
	var unique []string
	for _, root := range roots {
		if root == "" || seen[root] {
			continue
		}
		seen[root] = true
		unique = append(unique, root)
	}
	return unique
}

func androidToolCandidatesIn(name string, sdkRoots []string) []string {
	var candidates []string
	for _, sdk := range sdkRoots {
		switch name {
		case "emulator":
			candidates = append(candidates,
				filepath.Join(sdk, "emulator", "emulator"),
				filepath.Join(sdk, "emulator", "emulator.exe"),
			)
		case "adb":
			candidates = append(candidates,
				filepath.Join(sdk, "platform-tools", "adb"),
				filepath.Join(sdk, "platform-tools", "adb.exe"),
			)
		case "avdmanager":
			candidates = append(candidates, avdmanagerInRoot(sdk)...)
		}
	}
	if name == "avdmanager" {
		for _, prefix := range []string{"/opt/homebrew", "/usr/local"} {
			candidates = append(candidates, avdmanagerInRoot(filepath.Join(prefix, "share", "android-commandlinetools"))...)
		}
	}
	return candidates
}

func avdmanagerInRoot(root string) []string {
	var candidates []string
	latest := filepath.Join(root, "cmdline-tools", "latest", "bin", "avdmanager")
	candidates = append(candidates, latest, latest+".bat")
	entries, err := os.ReadDir(filepath.Join(root, "cmdline-tools"))
	if err != nil {
		return candidates
	}
	for _, entry := range entries {
		if !entry.IsDir() || entry.Name() == "latest" {
			continue
		}
		path := filepath.Join(root, "cmdline-tools", entry.Name(), "bin", "avdmanager")
		candidates = append(candidates, path, path+".bat")
	}
	return candidates
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
	command.Env = r.processEnv()
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

func (r execAndroidRunner) StartDetached(name string, args ...string) error {
	command := exec.Command(name, args...)
	command.Stdout = nil
	command.Stderr = nil
	command.Env = r.processEnv()
	withDetach(command)
	if err := command.Start(); err != nil {
		return err
	}
	return command.Process.Release()
}

func firstAndroidSDKRootIn(roots []string) string {
	for _, root := range roots {
		if info, err := os.Stat(root); err == nil && info.IsDir() {
			return root
		}
	}
	if len(roots) > 0 {
		return roots[0]
	}
	return ""
}

func firstAndroidSDKRoot() string {
	return firstAndroidSDKRootIn(androidSDKRoots())
}

func androidJavaHome() string {
	for _, candidate := range androidStudioJavaCandidates() {
		if home := validJavaHome(candidate); home != "" {
			return home
		}
	}
	if home := validJavaHome(os.Getenv("JAVA_HOME")); home != "" {
		return home
	}
	for _, candidate := range osJavaCandidates() {
		if home := validJavaHome(candidate); home != "" {
			return home
		}
	}
	if runtime.GOOS == "darwin" {
		if output, err := exec.Command("/usr/libexec/java_home", "-v", "17").Output(); err == nil {
			if home := validJavaHome(strings.TrimSpace(string(output))); home != "" {
				return home
			}
		}
	}
	return ""
}

func validJavaHome(home string) string {
	home = strings.TrimSpace(home)
	if home == "" {
		return ""
	}
	java := filepath.Join(home, "bin", "java")
	if runtime.GOOS == "windows" {
		if androidToolExists(java + ".exe") {
			return home
		}
	}
	if !androidToolExists(java) || isMacOSJavaStub(java) {
		return ""
	}
	return home
}

func isMacOSJavaStub(java string) bool {
	resolved, err := filepath.EvalSymlinks(java)
	if err != nil {
		resolved = java
	}
	return filepath.Clean(java) == "/usr/bin/java" || filepath.Clean(resolved) == "/usr/bin/java"
}

func (r execAndroidRunner) resolvedJavaHome() string {
	if override := strings.TrimSpace(r.javaHome); override != "" {
		if home := validJavaHome(override); home != "" {
			return home
		}
		return override
	}
	return androidJavaHome()
}

func (r execAndroidRunner) processEnv() []string {
	env := os.Environ()
	if sdk := firstAndroidSDKRootIn(r.sdkRoots()); sdk != "" {
		env = upsertEnv(env, "ANDROID_HOME", sdk)
		env = upsertEnv(env, "ANDROID_SDK_ROOT", sdk)
	}
	if javaHome := r.resolvedJavaHome(); javaHome != "" {
		env = upsertEnv(env, "JAVA_HOME", javaHome)
		env = prependPathEnv(env, filepath.Join(javaHome, "bin"))
	}
	return env
}

func androidProcessEnv() []string {
	return execAndroidRunner{}.processEnv()
}

func upsertEnv(env []string, key, value string) []string {
	if value == "" {
		return env
	}
	for i, item := range env {
		eq := strings.IndexByte(item, '=')
		if eq <= 0 {
			continue
		}
		if item[:eq] == key || (runtime.GOOS == "windows" && strings.EqualFold(item[:eq], key)) {
			env[i] = key + "=" + value
			return env
		}
	}
	return append(env, key+"="+value)
}

func prependPathEnv(env []string, dir string) []string {
	if dir == "" {
		return env
	}
	for i, item := range env {
		eq := strings.IndexByte(item, '=')
		if eq <= 0 {
			continue
		}
		if item[:eq] == "PATH" || (runtime.GOOS == "windows" && strings.EqualFold(item[:eq], "PATH")) {
			env[i] = item[:eq] + "=" + dir + string(os.PathListSeparator) + item[eq+1:]
			return env
		}
	}
	return append(env, "PATH="+dir)
}

func formatLabAVDCreateError(avd string, output []byte, err error) error {
	text := strings.TrimSpace(string(output))
	if isMissingJavaRuntimeOutput(text) {
		return fmt.Errorf("创建 %s 失败: 本机没有可用的 Java。请安装 Android Studio，然后在设置 → Lab 点重新检测", avd)
	}
	compact := compactAndroidToolOutput(text)
	if compact == "" && err != nil {
		return fmt.Errorf("创建 %s 失败: %v", avd, err)
	}
	if compact == "" {
		return fmt.Errorf("创建 %s 失败", avd)
	}
	return fmt.Errorf("创建 %s 失败: %s", avd, compact)
}

func isMissingJavaRuntimeOutput(text string) bool {
	return strings.Contains(text, "Unable to locate a Java Runtime") ||
		strings.Contains(text, "integer expression expected") ||
		strings.Contains(text, "JAVA_HOME is not set") ||
		strings.Contains(text, "JAVA_HOME is set to an invalid directory")
}

type AndroidTooling struct {
	SDKRoot       string
	JavaHome      string
	AutoCreateAVD bool
}

type AndroidToolingStatus struct {
	Ready          bool     `json:"ready"`
	CanStart       bool     `json:"canStart"`
	CanCreate      bool     `json:"canCreate"`
	Platform       string   `json:"platform"`
	StudioFound    bool     `json:"studioFound"`
	HasLabAVD      bool     `json:"hasLabAvd"`
	SDKRoot        string   `json:"sdkRoot"`
	SDKSource      string   `json:"sdkSource"`
	JavaHome       string   `json:"javaHome"`
	JavaSource     string   `json:"javaSource"`
	AVDManager     string   `json:"avdmanager"`
	Emulator       string   `json:"emulator"`
	ADB            string   `json:"adb"`
	SystemImage    string   `json:"systemImage"`
	JavaOK         bool     `json:"javaOk"`
	Missing        []string `json:"missing"`
	InstallURL     string   `json:"installUrl"`
	AutoDetectSDK  bool     `json:"autoDetectSdk"`
	AutoDetectJava bool     `json:"autoDetectJava"`
}

func ProbeAndroidTooling(tooling AndroidTooling) AndroidToolingStatus {
	overrideSDK := strings.TrimSpace(tooling.SDKRoot)
	overrideJava := strings.TrimSpace(tooling.JavaHome)
	runner := execAndroidRunner{sdkRoot: overrideSDK, javaHome: overrideJava}
	status := AndroidToolingStatus{
		Platform:       runtime.GOOS,
		StudioFound:    androidStudioPresent(),
		SDKRoot:        firstAndroidSDKRootIn(runner.sdkRoots()),
		JavaHome:       runner.resolvedJavaHome(),
		InstallURL:     AndroidStudioInstallURL,
		AutoDetectSDK:  overrideSDK == "",
		AutoDetectJava: overrideJava == "",
	}
	status.SDKSource = classifySDKSource(status.SDKRoot, overrideSDK)
	status.JavaSource = classifyJavaSource(status.JavaHome, overrideJava)
	status.JavaOK = validJavaHome(status.JavaHome) != ""
	status.SystemImage = findLabSystemImageIn(runner.sdkRoots())
	if path, err := runner.LookPath("avdmanager"); err == nil {
		status.AVDManager = path
	}
	if path, err := runner.LookPath("emulator"); err == nil {
		status.Emulator = path
	}
	if path, err := runner.LookPath("adb"); err == nil {
		status.ADB = path
	}
	if names, err := listAvds(runner); err == nil {
		status.HasLabAVD = len(labAVDs(names)) > 0
	}
	status.CanStart = status.Emulator != "" && status.ADB != ""
	status.CanCreate = status.CanStart && status.JavaOK && status.AVDManager != "" && status.SystemImage != ""
	if status.SDKRoot == "" {
		status.Missing = append(status.Missing, "sdk")
	}
	if status.Emulator == "" {
		status.Missing = append(status.Missing, "emulator")
	}
	if status.ADB == "" {
		status.Missing = append(status.Missing, "platform-tools")
	}
	if status.AVDManager == "" {
		status.Missing = append(status.Missing, "cmdline-tools")
	}
	if !status.JavaOK {
		status.Missing = append(status.Missing, "jdk")
	}
	if status.SystemImage == "" {
		status.Missing = append(status.Missing, "system-image")
	}
	status.Ready = status.CanStart && (status.HasLabAVD || status.CanCreate)
	return status
}

func compactAndroidToolOutput(text string) string {
	var keep []string
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.Contains(line, "integer expression expected") {
			continue
		}
		if strings.Contains(line, "Please visit http://www.java.com") {
			continue
		}
		keep = append(keep, line)
	}
	if len(keep) == 0 {
		return strings.TrimSpace(text)
	}
	if len(keep) > 3 {
		keep = keep[len(keep)-3:]
	}
	return strings.Join(keep, " ")
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
	return findLabSystemImageIn(androidSDKRoots())
}

func labSystemImage(runner androidRunner) string {
	if r, ok := runner.(execAndroidRunner); ok {
		if image := findLabSystemImageIn(r.sdkRoots()); image != "" {
			return image
		}
	}
	return detectLabSystemImage()
}

func findLabSystemImageIn(sdkRoots []string) string {
	abi := "x86_64"
	if runtime.GOARCH == "arm64" {
		abi = "arm64-v8a"
	}
	for _, sdk := range sdkRoots {
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

func ensureLabAVD(ctx context.Context, runner androidRunner, autoCreate bool) (string, error) {
	names, err := listAvds(runner)
	if err != nil {
		return "", err
	}
	if labs := labAVDs(names); len(labs) > 0 {
		return labs[0], nil
	}
	if !autoCreate {
		return "", fmt.Errorf("没有名为 %s 的实验室模拟器。请在设置 → Lab 开启自动创建，或在 Android Studio 里建这个 AVD", labAVDPrefix)
	}
	image := labSystemImage(runner)
	if image == "" {
		return "", fmt.Errorf("没有实验室模拟器 %s，也没有可用来创建它的系统镜像。请打开 Android Studio → SDK Manager 安装系统镜像，然后在设置 → Lab 重新检测。不要用日常手机模拟器", labAVDPrefix)
	}
	manager, err := runner.LookPath("avdmanager")
	if err != nil {
		return "", fmt.Errorf("没有命令行工具。打开 Android Studio → SDK Manager，勾选 Android SDK Command-line Tools，然后在设置 → Lab 重新检测")
	}
	output, createErr := runner.CombinedOutput(ctx, manager, "create", "avd", "--force", "--name", labAVDPrefix, "--package", image, "--device", "pixel")
	if createErr != nil {
		return "", formatLabAVDCreateError(labAVDPrefix, output, createErr)
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

func allocateAndroidDevice(ctx context.Context, runner androidRunner, heldDevices, heldSerials map[string]bool, autoCreate bool) (androidDevice, error) {
	if heldDevices == nil {
		heldDevices = map[string]bool{}
	}
	if heldSerials == nil {
		heldSerials = map[string]bool{}
	}
	if _, err := ensureLabAVD(ctx, runner, autoCreate); err != nil {
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
		if !autoCreate {
			return androidDevice{}, errAndroidBusy
		}
		next := nextLabAVDName(labs)
		if next == "" {
			return androidDevice{}, errAndroidBusy
		}
		image := labSystemImage(runner)
		if image == "" {
			return androidDevice{}, errAndroidBusy
		}
		manager, lookErr := runner.LookPath("avdmanager")
		if lookErr != nil {
			return androidDevice{}, errAndroidBusy
		}
		if output, createErr := runner.CombinedOutput(ctx, manager, "create", "avd", "--force", "--name", next, "--package", image, "--device", "pixel"); createErr != nil {
			return androidDevice{}, formatLabAVDCreateError(next, output, createErr)
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
